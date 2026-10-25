// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnalyticsRepository, analyticsWindow } from './analytics.js'

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }))
vi.mock('pg', () => ({
  Pool: class {
    query = database.query
    end = database.end
  },
}))

describe('shared account analytics', () => {
  const config = { host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test' }
  const input = { accountKey: 'account-one', accountId: 1, groupIds: [2, 3], range: 'week' as const }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
    database.query.mockReset().mockResolvedValue({ rows: [] })
  })
  afterEach(() => vi.useRealTimers())

  it('场景-005-05：合并相同范围的在途查询并保留原有指标和零用量用户', async () => {
    let finish!: (value: { rows: object[] }) => void
    const pending = new Promise<{ rows: object[] }>((resolve) => { finish = resolve })
    database.query.mockImplementation((sql: string) => sql.includes('FROM usage_logs')
      ? pending
      : Promise.resolve({ rows: [{ user_id: 2, email: 'idle@example.test', username: 'idle' }] }))
    const repository = new AnalyticsRepository(config)
    const first = repository.accountAnalytics(input)
    const second = repository.accountAnalytics({ ...input, groupIds: [3, 2] })
    finish({ rows: [{
      user_id: 1, email: 'active@example.test', username: 'active', model: 'model-one',
      requests: 2, input_tokens: 100, output_tokens: 20, cache_read_tokens: 50, cache_creation_tokens: 10,
      cost_usd: 0.5, first_token_sum_ms: 400, first_token_samples: 2, duration_sum_ms: 2400,
      duration_samples: 2, tps_output_tokens: 20, generation_duration_ms: 2000,
      websocket_requests: 1, stream_requests: 1, sync_requests: 0, live_requests: 0,
    }] })

    const [left, right] = await Promise.all([first, second])
    expect(database.query).toHaveBeenCalledTimes(2)
    expect(left).toEqual(right)
    expect(left).toMatchObject({ requests: 2, totalTokens: 180, costUsd: 0.5, averageTps: 10,
      averageFirstTokenMs: 200, averageDurationMs: 1200, usersWithUsage: 1,
      requestTypes: { websocket: 1, stream: 1, sync: 0, live: 0, other: 0 } })
    expect(left.users).toHaveLength(2)
    expect(left.users[1]).toMatchObject({ userId: 2, requests: 0, costUsd: 0, models: [] })
  })

  it('场景-005-06：30 秒内复用实际统计窗口，到期重新读取', async () => {
    const repository = new AnalyticsRepository(config)
    const first = await repository.accountAnalytics(input)
    vi.advanceTimersByTime(29_999)
    expect(await repository.accountAnalytics(input)).toEqual(first)
    expect(database.query).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    const refreshed = await repository.accountAnalytics(input)
    expect(database.query).toHaveBeenCalledTimes(4)
    expect(Date.parse(refreshed.endAt) - Date.parse(first.endAt)).toBe(30_000)
  })

  it('场景-005-07：失败后再次请求会重试数据库', async () => {
    const repository = new AnalyticsRepository(config)
    database.query.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(repository.accountAnalytics(input)).rejects.toThrow('database unavailable')
    await expect(repository.accountAnalytics(input)).resolves.toMatchObject({ requests: 0 })
    expect(database.query).toHaveBeenCalledTimes(4)
  })

  it('场景-005-07：账号、分组、范围及周期边界分别隔离', async () => {
    const repository = new AnalyticsRepository(config)
    for (const variation of [
      input, { ...input, accountId: 2 }, { ...input, accountKey: 'account-two' },
      { ...input, groupIds: [2, 4] }, { ...input, range: 'month' as const },
      { ...input, range: 'cycle' as const, cycle: { resetAt: 1792800000, startAt: 1792195200, status: 'completed' as const } },
      { ...input, range: 'cycle' as const, cycle: { resetAt: 1792195200, startAt: 1791590400, status: 'completed' as const } },
    ]) await repository.accountAnalytics(variation)
    expect(database.query).toHaveBeenCalledTimes(14)
  })

  it('场景-005-08：缓存淘汰最早的范围，避免持续累积', async () => {
    const repository = new AnalyticsRepository(config)
    await repository.accountAnalytics(input)
    for (let accountId = 2; accountId <= 33; accountId += 1) {
      await repository.accountAnalytics({ ...input, accountId })
    }
    expect(database.query).toHaveBeenCalledTimes(66)
    await repository.accountAnalytics(input)
    expect(database.query).toHaveBeenCalledTimes(68)
  })
})

describe('analyticsWindow', () => {
  afterEach(() => vi.useRealTimers())

  it('limits the current cycle to the time observed so far', () => {
    const now = new Date('2026-08-19T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const window = analyticsWindow({
      range: 'cycle',
      cycle: { resetAt: Math.floor(new Date('2026-08-20T12:00:00.000Z').getTime() / 1_000), startAt: Math.floor(new Date('2026-08-13T12:00:00.000Z').getTime() / 1_000), status: 'current' },
    })

    expect(window.startAt.toISOString()).toBe('2026-08-13T12:00:00.000Z')
    expect(window.endAt.toISOString()).toBe('2026-08-19T12:00:00.000Z')
    expect(window.cycleResetAt).toBe(Math.floor(new Date('2026-08-20T12:00:00.000Z').getTime() / 1_000))
  })

  it('uses the reset boundary as the end of a completed cycle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'))

    const window = analyticsWindow({
      range: 'cycle',
      cycle: { resetAt: Math.floor(new Date('2026-08-13T12:00:00.000Z').getTime() / 1_000), startAt: Math.floor(new Date('2026-08-06T12:00:00.000Z').getTime() / 1_000), status: 'completed' },
    })

    expect(window.startAt.toISOString()).toBe('2026-08-06T12:00:00.000Z')
    expect(window.endAt.toISOString()).toBe('2026-08-13T12:00:00.000Z')
  })

  it('rejects a cycle with an empty or reversed window', () => {
    expect(() => analyticsWindow({ range: 'cycle' })).toThrow('未提供有效的重置周期')
    expect(() => analyticsWindow({
      range: 'cycle',
      cycle: { resetAt: 100, startAt: 200, status: 'completed' },
    })).toThrow('重置周期时间范围无效')
  })
})
