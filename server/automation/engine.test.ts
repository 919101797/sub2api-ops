// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServiceConfig } from '../../shared/contracts.js'
import { StateStore } from '../store.js'
import { Sub2ApiClient } from '../sub2api-client.js'
import { AutomationEngine } from './engine.js'

const temporaryDirectories: string[] = []

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
    key: 'primary',
    email: 'primary@example.com',
    label: '示例主账号',
    shareCount: 3,
    reserveMode: 'usd',
    reserveValue: 120,
    targetGroupIds: [5, 13],
    enabled: true,
  }],
}

afterEach(async () => {
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
    const engine = new AutomationEngine(config, client, store)
    await engine.initialize()

    await store.updateAccount('primary', (account) => {
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

    expect(store.snapshot().accounts['primary']?.capacity).toMatchObject({
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
    const engine = new AutomationEngine(config, client, store)
    await engine.initialize()

    await store.updateAccount('primary', (account) => {
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

    const account = store.snapshot().accounts['primary']!
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
    const engine = new AutomationEngine(changedConfig, client, store)
    await engine.initialize()

    await store.updateAccount('primary', (account) => {
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

    expect(store.snapshot().accounts['primary']?.capacity).toMatchObject({
      reserveUsd: 300,
      estimatedCycleCapacityUsd: 2_500,
      allocatableCapacityUsd: 2_200,
      perShareCapacityUsd: 733.33,
    })
  })
})

describe('AutomationEngine user concurrency schedule', () => {
  it('uses editable peak and idle limits while skipping unchanged and disabled users', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quota-sync-engine-'))
    temporaryDirectories.push(directory)
    const store = new StateStore(join(directory, 'state.json'))
    await store.initialize()
    const client = new Sub2ApiClient('http://example.test', 'test-key', 1_000)
    const enabledConfig: ServiceConfig = {
      ...config,
      userConcurrencySchedule: { ...config.userConcurrencySchedule, enabled: true, peakConcurrency: 2, idleConcurrency: 7, peakRpm: 30, idleRpm: 40, exemptUserIds: [2] },
    }
    const engine = new AutomationEngine(enabledConfig, client, store)
    await engine.initialize()

    vi.spyOn(client, 'users').mockResolvedValue([
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
    const engine = new AutomationEngine(enabledConfig, client, store)
    await engine.initialize()

    vi.spyOn(client, 'users').mockResolvedValue([
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
    const engine = new AutomationEngine(enabledConfig, client, store)
    await engine.initialize()

    vi.spyOn(client, 'users').mockResolvedValue([
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
