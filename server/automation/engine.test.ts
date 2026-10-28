// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ServiceConfig } from '../../shared/contracts.js'
import { StateStore } from '../store.js'
import { loadConfig, saveConfig } from '../config.js'
import { Sub2ApiClient, type UpstreamUser } from '../sub2api-client.js'
import { AutomationEngine } from './engine.js'

const temporaryDirectories: string[] = []
const readUsers = vi.fn<() => Promise<UpstreamUser[]>>()
const persistConfig = vi.fn<(config: ServiceConfig) => Promise<void>>().mockResolvedValue(undefined)
beforeEach(() => { readUsers.mockReset().mockResolvedValue([]); persistConfig.mockClear() })

const config: ServiceConfig = {
  version: 11,
  fixedGroupIds: [10, 11],
  resetSync: {
    intervalSeconds: 180,
    requestTimeoutSeconds: 25,
    resetAtToleranceSeconds: 300,
    usageDropTolerancePercent: 0.5,
  },
  capacitySync: {
    intervalSeconds: 600,
    minimumUsedPercent: 5,
    minimumChangeUsd: 1,
  },
  promptAudit: { maxRequestBodyMiB: 10, normalRetentionDays: 7, riskRetentionDays: 60 },
  userConcurrencySchedule: {
    enabled: false,
    timezone: 'Asia/Singapore',
    peakWindows: [{ start: '11:00', end: '12:00' }, { start: '14:00', end: '17:00' }],
    peakConcurrency: 3,
    idleConcurrency: 5,
    peakRpm: 30,
    idleRpm: 40,
    exemptUserIds: [],
  },
  accounts: [{
    key: '163',
    email: 'one@example.com',
    label: '163.com 主账号',
    shareCount: 3,
    redistributionEnabled: false,
    reserveMode: 'usd',
    reserveValue: 120,
    targetGroupIds: [5, 13],
    enabled: true,
  }],
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('AutomationEngine capacity synchronization', () => {
  it('backfills an initial estimate while usage remains in an already sampled eligible bucket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quota-sync-engine-'))
    temporaryDirectories.push(directory)
    const store = new StateStore(join(directory, 'state.json'))
    await store.initialize()
    const client = new Sub2ApiClient('http://example.test', 'test-key', 1_000)
    const engine = new AutomationEngine(config, client, store, readUsers, persistConfig)
    await engine.initialize()

    await store.updateAccount('163', (account) => {
      account.accountId = 5
      account.capacity = {
        observedAt: '2026-08-24T06:52:44.976Z',
        resetAt: 1_787_801_340,
        usedPercent: 6,
        localStandardCostUsd: 176.28,
        reserveUsd: 120,
        shareCount: 3,
        activeSubscriptions: 0,
        status: 'insufficient-sample',
        message: '使用率仍在 6% 桶内，仅采样，未更新分组',
        groups: [],
        estimationSamples: [
          { observedAt: '2026-08-24T04:20:22.682Z', usedPercent: 5, percentBucket: 5, standardCostUsd: 120 },
          { observedAt: '2026-08-24T06:52:44.976Z', usedPercent: 6, percentBucket: 6, standardCostUsd: 150 },
        ],
      }
    })

    vi.spyOn(client, 'openAIQuota').mockResolvedValue({
      rate_limit: { primary_window: { reset_at: 1_787_801_352, used_percent: 6.4 } },
      fetched_at: 1_777_000_000,
    })
    vi.spyOn(client, 'accountUsage').mockResolvedValue({
      seven_day: { utilization: 0.064, resets_at: null, window_stats: { standard_cost: 160 } },
    })
    vi.spyOn(client, 'activeSubscriptions').mockResolvedValue([])
    vi.spyOn(client, 'group').mockImplementation(async (groupId) => ({
      id: groupId,
      name: `Group ${groupId}`,
      rate_multiplier: 1,
      daily_limit_usd: null,
      weekly_limit_usd: null,
      monthly_limit_usd: null,
    }))
    const updateSpy = vi.spyOn(client, 'updateGroupWeeklyLimit').mockImplementation(async (group, weeklyLimitUsd) => ({
      ...group,
      weekly_limit_usd: weeklyLimitUsd,
    }))

    await engine.run('capacity')

    expect(store.snapshot().accounts['163']?.capacity).toMatchObject({
      status: 'updated',
      message: '已更新 2 个分组',
      estimatedCycleCapacityUsd: 2_450,
      allocatableCapacityUsd: 2_330,
      perShareCapacityUsd: 776.67,
    })
    expect(updateSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 5 }), 776.67)
    expect(updateSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 13 }), 776.67)
  })

  it('keeps the last stable estimate when reset_at jitters after samples were lost', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quota-sync-engine-'))
    temporaryDirectories.push(directory)
    const store = new StateStore(join(directory, 'state.json'))
    await store.initialize()
    const client = new Sub2ApiClient('http://example.test', 'test-key', 1_000)
    const engine = new AutomationEngine(config, client, store, readUsers, persistConfig)
    await engine.initialize()

    await store.updateAccount('163', (account) => {
      account.accountId = 5
      account.reset.cycles = [{
        resetAt: 1_787_801_340,
        startAt: 1_787_196_540,
        status: 'current',
        observedAt: '2026-08-20T03:06:00.000Z',
        usedPercent: 12,
        usageUsd: 283.46,
        estimatedCycleCapacityUsd: 2_362.18,
        reserveUsd: 120,
        allocatableCapacityUsd: 2_242.18,
        perShareCapacityUsd: 747.39,
      }]
      account.capacity = {
        observedAt: '2026-08-21T03:20:00.000Z',
        resetAt: 1_787_801_349,
        usedPercent: 15,
        localStandardCostUsd: 352.07,
        reserveUsd: 120,
        shareCount: 3,
        activeSubscriptions: 0,
        status: 'insufficient-sample',
        message: '已采集 1/3 个不同使用率样本',
        groups: [],
        estimationSamples: [{
          observedAt: '2026-08-21T03:20:00.000Z',
          usedPercent: 15,
          percentBucket: 15,
          standardCostUsd: 352.07,
        }],
      }
    })

    vi.spyOn(client, 'openAIQuota').mockResolvedValue({
      rate_limit: { primary_window: { reset_at: 1_787_801_352, used_percent: 15.4 } },
      fetched_at: 1_777_000_000,
    })
    vi.spyOn(client, 'accountUsage').mockResolvedValue({
      seven_day: { utilization: 0.154, resets_at: null, window_stats: { standard_cost: 354.02 } },
    })
    vi.spyOn(client, 'activeSubscriptions').mockResolvedValue([])
    const groupSpy = vi.spyOn(client, 'group')
    const updateSpy = vi.spyOn(client, 'updateGroupWeeklyLimit')

    await engine.run('capacity')

    const account = store.snapshot().accounts['163']!
    expect(account.capacity).toMatchObject({
      resetAt: 1_787_801_340,
      status: 'unchanged',
      estimatedCycleCapacityUsd: 2_362.18,
      reserveUsd: 120,
      allocatableCapacityUsd: 2_242.18,
      perShareCapacityUsd: 747.39,
    })
    expect(account.capacity?.estimationSamples?.map((sample) => sample.percentBucket)).toEqual([15])
    expect(account.reset.cycles).toHaveLength(1)
    expect(account.reset.cycles?.[0]).toMatchObject({
      resetAt: 1_787_801_340,
      estimatedCycleCapacityUsd: 2_362.18,
      perShareCapacityUsd: 747.39,
    })
    expect(groupSpy).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('场景-003-06：切换为百分比预留后在同一使用率桶内重算', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quota-sync-engine-'))
    temporaryDirectories.push(directory)
    const store = new StateStore(join(directory, 'state.json'))
    await store.initialize()
    const client = new Sub2ApiClient('http://example.test', 'test-key', 1_000)
    const changedConfig: ServiceConfig = {
      ...config,
      accounts: [{ ...config.accounts[0]!, reserveMode: 'percent', reserveValue: 12 }],
    }
    const engine = new AutomationEngine(changedConfig, client, store, readUsers, persistConfig)
    await engine.initialize()

    await store.updateAccount('163', (account) => {
      account.accountId = 5
      account.capacity = {
        observedAt: '2026-08-24T06:52:44.976Z',
        resetAt: 1_787_801_340,
        usedPercent: 6,
        localStandardCostUsd: 150,
        estimatedCycleCapacityUsd: 2_500,
        reserveUsd: 120,
        allocatableCapacityUsd: 2_380,
        perShareCapacityUsd: 793.33,
        shareCount: 3,
        activeSubscriptions: 0,
        status: 'unchanged',
        message: '分组周限已是最新值',
        groups: [],
        estimationSamples: [
          { observedAt: '2026-08-24T06:52:44.976Z', usedPercent: 6, percentBucket: 6, standardCostUsd: 150 },
        ],
      }
    })

    vi.spyOn(client, 'openAIQuota').mockResolvedValue({
      rate_limit: { primary_window: { reset_at: 1_787_801_352, used_percent: 6.4 } },
      fetched_at: 1_777_000_000,
    })
    vi.spyOn(client, 'accountUsage').mockResolvedValue({
      seven_day: { utilization: 0.064, resets_at: null, window_stats: { standard_cost: 160 } },
    })
    vi.spyOn(client, 'activeSubscriptions').mockResolvedValue([])
    vi.spyOn(client, 'group').mockImplementation(async (groupId) => ({
      id: groupId,
      name: `Group ${groupId}`,
      rate_multiplier: 1,
      daily_limit_usd: null,
      weekly_limit_usd: null,
      monthly_limit_usd: null,
    }))
    vi.spyOn(client, 'updateGroupWeeklyLimit').mockImplementation(async (group, weeklyLimitUsd) => ({
      ...group,
      weekly_limit_usd: weeklyLimitUsd,
    }))

    await engine.run('capacity')

    expect(store.snapshot().accounts['163']?.capacity).toMatchObject({
      reserveUsd: 300,
      estimatedCycleCapacityUsd: 2_500,
      allocatableCapacityUsd: 2_200,
      perShareCapacityUsd: 733.33,
    })
  })
})

describe('AutomationEngine user concurrency schedule', () => {
  it('场景-009-09：只读查询失败时不写入任何限制并记录错误', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quota-sync-user-limits-'))
    temporaryDirectories.push(directory)
    const store = new StateStore(join(directory, 'state.json'))
    await store.initialize()
    const client = new Sub2ApiClient('http://example.test', 'test-key', 1_000)
    const engine = new AutomationEngine({ ...config, userConcurrencySchedule: { ...config.userConcurrencySchedule, enabled: true } }, client, store, readUsers, persistConfig)
    await engine.initialize()
    readUsers.mockRejectedValueOnce(new Error('read-only database unavailable'))
    const write = vi.spyOn(client, 'batchSetUserLimits')
    await expect(engine.runUserConcurrency()).rejects.toThrow('read-only database unavailable')
    expect(write).not.toHaveBeenCalled()
    expect(store.snapshot().events[0]).toMatchObject({ severity: 'error', category: 'concurrency' })
  })

  it('场景-009-08：独立读取当前限制并保留高峰、豁免和禁用规则', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quota-sync-engine-'))
    temporaryDirectories.push(directory)
    const store = new StateStore(join(directory, 'state.json'))
    await store.initialize()
    const client = new Sub2ApiClient('http://example.test', 'test-key', 1_000)
    const enabledConfig: ServiceConfig = {
      ...config,
      userConcurrencySchedule: { ...config.userConcurrencySchedule, enabled: true, peakConcurrency: 2, idleConcurrency: 7, peakRpm: 30, idleRpm: 40, exemptUserIds: [2] },
    }
    const engine = new AutomationEngine(enabledConfig, client, store, readUsers, persistConfig)
    await engine.initialize()

    readUsers.mockResolvedValue([
      { id: 1, email: 'one@example.com', username: 'one', role: 'user', status: 'active', concurrency: 5, rpm_limit: 30 },
      { id: 2, email: 'two@example.com', username: 'two', role: 'user', status: 'active', concurrency: 3, rpm_limit: 30 },
      { id: 3, email: 'three@example.com', username: 'three', role: 'user', status: 'disabled', concurrency: 5, rpm_limit: 0 },
      { id: 4, email: 'four@example.com', username: 'four', role: 'user', status: 'active', concurrency: 2, rpm_limit: 0 },
    ])
    const update = vi.spyOn(client, 'batchSetUserLimits').mockResolvedValue(1)

    await engine.runUserConcurrency(new Date('2026-08-26T14:30:00+08:00'))

    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenNthCalledWith(1, [1, 4], { concurrency: 2, rpmLimit: 30 })
    expect(update).toHaveBeenNthCalledWith(2, [2], { concurrency: 7, rpmLimit: 0 })
    expect(store.snapshot().events[0]).toMatchObject({
      category: 'concurrency',
      severity: 'success',
      details: { peakUsers: 2, defaultUsers: 0, exemptUsers: 1, peakConcurrency: 2, idleConcurrency: 7, peakRpm: 30, idleRpm: 40, period: 'peak' },
    })
  })

  it('场景-009-07：豁免用户在闲时也保持闲时并发且 RPM 不限', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quota-sync-engine-'))
    temporaryDirectories.push(directory)
    const store = new StateStore(join(directory, 'state.json'))
    await store.initialize()
    const client = new Sub2ApiClient('http://example.test', 'test-key', 1_000)
    const enabledConfig: ServiceConfig = {
      ...config,
      userConcurrencySchedule: { ...config.userConcurrencySchedule, enabled: true, idleConcurrency: 7, idleRpm: 40, exemptUserIds: [2] },
    }
    const engine = new AutomationEngine(enabledConfig, client, store, readUsers, persistConfig)
    await engine.initialize()

    readUsers.mockResolvedValue([
      { id: 2, email: 'two@example.com', username: 'two', role: 'user', status: 'active', concurrency: 7, rpm_limit: 40 },
    ])
    const update = vi.spyOn(client, 'batchSetUserLimits').mockResolvedValue(1)

    await engine.runUserConcurrency(new Date('2026-08-26T12:30:00+08:00'))

    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith([2], { concurrency: 7, rpmLimit: 0 })
  })

  it('restores active users to the editable idle limit when an enabled schedule is disabled', async () => {
    vi.useFakeTimers()
    const directory = await mkdtemp(join(tmpdir(), 'quota-sync-engine-'))
    temporaryDirectories.push(directory)
    const store = new StateStore(join(directory, 'state.json'))
    await store.initialize()
    const client = new Sub2ApiClient('http://example.test', 'test-key', 1_000)
    const enabledConfig: ServiceConfig = {
      ...config,
      userConcurrencySchedule: { ...config.userConcurrencySchedule, enabled: true, peakConcurrency: 2, idleConcurrency: 7, peakRpm: 30, idleRpm: 40, exemptUserIds: [] },
    }
    const engine = new AutomationEngine(enabledConfig, client, store, readUsers, persistConfig)
    await engine.initialize()

    readUsers.mockResolvedValue([
      { id: 1, email: 'one@example.com', username: 'one', role: 'user', status: 'active', concurrency: 2, rpm_limit: 30 },
      { id: 2, email: 'two@example.com', username: 'two', role: 'user', status: 'active', concurrency: 7, rpm_limit: 40 },
    ])
    const update = vi.spyOn(client, 'batchSetUserLimits').mockResolvedValue(1)

    await engine.replaceConfig({
      ...enabledConfig,
      userConcurrencySchedule: { ...config.userConcurrencySchedule, enabled: false, peakConcurrency: 2, idleConcurrency: 7, peakRpm: 30, idleRpm: 40, exemptUserIds: [] },
    })
    engine.stop()
    await store.update(() => undefined)
    vi.useRealTimers()

    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith([1], { concurrency: 7, rpmLimit: 40 })
  })
})

it('场景-002-01/03/06：首次基线和窗口抖动保持再均分开启', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quota-sync-baseline-')); temporaryDirectories.push(directory)
  const store = new StateStore(join(directory, 'state.json')); await store.initialize()
  const client = new Sub2ApiClient('http://example.test', 'test-key', 1000)
  const enabled = { ...structuredClone(config), accounts: [{ ...config.accounts[0]!, redistributionEnabled: true }] }
  const engine = new AutomationEngine(enabled, client, store, readUsers, persistConfig); await engine.initialize()
  await store.updateAccount('163', account => { account.accountId = 5 })
  let resetAt = 2_000_000_000
  vi.spyOn(client, 'openAIQuota').mockImplementation(async () => ({ rate_limit: { primary_window: { reset_at: resetAt, used_percent: 40 } }, fetched_at: resetAt - 100000 }))
  await engine.run('reset')
  resetAt += 10
  await engine.run('reset')
  expect(engine.getConfig().accounts[0]!.redistributionEnabled).toBe(true)
  expect(persistConfig).not.toHaveBeenCalled()
})

it('场景-002-06/003-09/10/13：主动追加不重复，新周期持久关闭，保存及重置失败可恢复', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quota-sync-engine-')); temporaryDirectories.push(directory)
  const store = new StateStore(join(directory, 'state.json')); await store.initialize()
  const client = new Sub2ApiClient('http://example.test', 'test-key', 1000)
  const enabled: ServiceConfig = { ...structuredClone(config), accounts: [{ ...config.accounts[0]!, reserveValue: 100, redistributionEnabled: true }] }
  enabled.accounts.push({ ...enabled.accounts[0]!, key: 'two', email: 'two@example.com', targetGroupIds: [14], enabled: false })
  const configPath = join(directory, 'config.json')
  const persist = vi.fn((next: ServiceConfig) => saveConfig(configPath, next))
  await saveConfig(configPath, enabled)
  const engine = new AutomationEngine(enabled, client, store, readUsers, persist); await engine.initialize()
  let resetAt = 2_000_000_000, usedPercent = 40, cost = 400, memberUsage = 100
  await store.updateAccount('163', account => { account.accountId = 5; account.reset.observation = { resetAt, usedPercent, fetchedAt: resetAt - 100000, observedAt: new Date().toISOString() } })
  vi.spyOn(client, 'openAIQuota').mockImplementation(async () => ({ rate_limit: { primary_window: { reset_at: resetAt, used_percent: usedPercent } }, fetched_at: resetAt - 100000 }))
  vi.spyOn(client, 'accountUsage').mockImplementation(async () => ({ seven_day: { utilization: usedPercent / 100, resets_at: null, window_stats: { standard_cost: cost } } }))
  vi.spyOn(client, 'activeSubscriptions').mockImplementation(async () => [{ id: 1, user_id: 1, group_id: 5, status: 'active', weekly_usage_usd: memberUsage }])
  const groups = [5,13].map(id => ({ id, name: `Group ${id}`, rate_multiplier: 1, daily_limit_usd: null, weekly_limit_usd: 300, monthly_limit_usd: null }))
  vi.spyOn(client, 'group').mockImplementation(async id => ({ ...groups.find(g => g.id === id)! }))
  const update = vi.spyOn(client, 'updateGroupWeeklyLimit').mockImplementation(async (group, limit) => { groups.find(g => g.id === group.id)!.weekly_limit_usd = limit; return { ...group, weekly_limit_usd: limit } })
  await engine.run('capacity')
  expect(groups.map(g => g.weekly_limit_usd)).toEqual([466.66,466.66])
  expect(store.snapshot().accounts['163']!.capacity!.perShareCapacityUsd).toBe(300)
  await engine.run('capacity')
  expect(update).toHaveBeenCalledTimes(2)
  memberUsage = 466.66; usedPercent = 40.5; cost = 450
  await engine.run('capacity')
  expect(groups.map(g => g.weekly_limit_usd)).toEqual([466.66,466.66])
  memberUsage = 466.66; usedPercent = 50; cost = 1000
  await engine.run('capacity')
  expect(groups.map(g => g.weekly_limit_usd)).toEqual([599.99,599.99])
  memberUsage = 500; usedPercent = 60; cost = 1200
  await engine.run('capacity')
  expect(groups.map(g => g.weekly_limit_usd)).toEqual([766.66,766.66])
  enabled.accounts[0]!.redistributionEnabled = false
  memberUsage = 600
  await engine.run('capacity')
  expect(groups.map(g => g.weekly_limit_usd)).toEqual([766.66,766.66])
  expect(store.snapshot().accounts['163']!.redistribution!.status).toBe('disabled')
  resetAt += 604800; usedPercent = 1; cost = 10
  enabled.accounts[0]!.redistributionEnabled = true
  const resetSubscriptions = vi.spyOn(client, 'resetSubscriptionWeekly').mockImplementation(async () => { memberUsage = 0 })
  await engine.run('capacity')
  expect(store.snapshot().accounts['163']!.redistribution!.message).toContain('重置')
  persist.mockRejectedValueOnce(new Error('configuration storage unavailable'))
  await engine.run('reset')
  expect(resetSubscriptions).not.toHaveBeenCalled()
  expect(engine.getConfig().accounts[0]!.redistributionEnabled).toBe(true)
  expect((await loadConfig(configPath)).accounts[0]!.redistributionEnabled).toBe(true)
  update.mockRejectedValueOnce(new Error('temporary group reset failure'))
  await engine.run('reset')
  expect(resetSubscriptions).not.toHaveBeenCalled()
  expect(engine.getConfig().accounts.map(a => a.redistributionEnabled)).toEqual([false,true])
  expect((await loadConfig(configPath)).accounts.map(a => a.redistributionEnabled)).toEqual([false,true])
  expect(store.snapshot().accounts['163']!.reset.pendingEvent?.restoreRedistributionLimits?.limitUsd).toBe(633.33)
  await engine.run('reset')
  await engine.run('capacity')
  expect(groups.map(g => g.weekly_limit_usd)).toEqual([633.33,633.33])
  expect(store.snapshot().accounts['163']!.redistribution!.rounds).toBe(0)
  expect(store.snapshot().accounts['163']!.redistribution!.status).toBe('disabled')
  const restarted = new AutomationEngine(await loadConfig(configPath), client, store, readUsers, persist)
  await restarted.initialize()
  expect(restarted.getConfig().accounts[0]!.redistributionEnabled).toBe(false)
})

it('场景-003-11：同一账号的周期重置和额度追加串行执行', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quota-sync-serial-')); temporaryDirectories.push(directory)
  const store = new StateStore(join(directory, 'state.json')); await store.initialize()
  const client = new Sub2ApiClient('http://example.test', 'test-key', 1000)
  const engine = new AutomationEngine(config, client, store, readUsers, persistConfig); await engine.initialize()
  await store.updateAccount('163', account => { account.accountId = 5 })
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const quota = vi.spyOn(client, 'openAIQuota').mockImplementation(async () => { entered(); await gate; return { rate_limit: { primary_window: { reset_at: 2000000000, used_percent: 1 } }, fetched_at: 1999999999 } })
  vi.spyOn(client, 'accountUsage').mockResolvedValue({ seven_day: { utilization: .01, resets_at: null, window_stats: { standard_cost: 10 } } })
  vi.spyOn(client, 'activeSubscriptions').mockResolvedValue([])
  const reset = engine.run('reset'); await started
  const capacity = engine.run('capacity')
  await new Promise(resolve => setImmediate(resolve))
  expect(quota).toHaveBeenCalledTimes(1)
  release(); await Promise.all([reset, capacity])
  expect(quota).toHaveBeenCalledTimes(2)
})
