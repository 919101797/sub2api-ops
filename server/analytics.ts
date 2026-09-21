import { Pool } from 'pg'

import type {
  AccountAnalyticsResponse,
  AccountModelAnalytics,
  AccountUserAnalytics,
  AnalyticsRange,
  RequestTypeBreakdown,
  UsageAnalyticsMetrics,
} from '../shared/contracts.js'

interface AnalyticsDatabaseConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export interface AnalyticsCycleWindow {
  resetAt: number
  startAt: number
  status: 'current' | 'completed'
}

interface ModelUsageRow {
  user_id: string | number
  email: string
  username: string | null
  model: string | null
  requests: string | number
  input_tokens: string | number
  output_tokens: string | number
  cache_read_tokens: string | number
  cache_creation_tokens: string | number
  cost_usd: string | number
  first_token_sum_ms: string | number
  first_token_samples: string | number
  duration_sum_ms: string | number
  duration_samples: string | number
  tps_output_tokens: string | number
  generation_duration_ms: string | number
  websocket_requests: string | number
  stream_requests: string | number
  sync_requests: string | number
  live_requests: string | number
}

interface EligibleUserRow {
  user_id: string | number
  email: string
  username: string | null
}

interface UsagePrimitives {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  firstTokenSumMs: number
  firstTokenSamples: number
  durationSumMs: number
  durationSamples: number
  tpsOutputTokens: number
  generationDurationMs: number
  requestTypes: RequestTypeBreakdown
}

interface UserAccumulator {
  userId: number
  email: string
  username: string
  metrics: UsagePrimitives
  models: AccountModelAnalytics[]
}

const RANGE_SECONDS: Record<Exclude<AnalyticsRange, 'cycle'>, number> = {
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60,
}

export function analyticsWindow(input: {
  range: AnalyticsRange
  cycle?: AnalyticsCycleWindow
}): { startAt: Date; endAt: Date; cycleResetAt?: number } {
  const now = new Date()
  if (input.range === 'cycle') {
    if (!input.cycle) throw new Error('未提供有效的重置周期')
    const startAt = new Date(input.cycle.startAt * 1_000)
    const endAt = new Date(Math.min(now.getTime(), input.cycle.resetAt * 1_000))
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
      throw new Error('重置周期时间范围无效')
    }
    return { startAt, endAt, cycleResetAt: input.cycle.resetAt }
  }
  return {
    startAt: new Date(now.getTime() - RANGE_SECONDS[input.range] * 1_000),
    endAt: now,
  }
}

const MODEL_USAGE_QUERY = `
  SELECT
    usage_logs.user_id,
    users.email,
    users.username,
    usage_logs.model,
    COUNT(*) AS requests,
    COALESCE(SUM(usage_logs.input_tokens), 0) AS input_tokens,
    COALESCE(SUM(usage_logs.output_tokens), 0) AS output_tokens,
    COALESCE(SUM(usage_logs.cache_read_tokens), 0) AS cache_read_tokens,
    COALESCE(SUM(usage_logs.cache_creation_tokens), 0) AS cache_creation_tokens,
    COALESCE(SUM(usage_logs.actual_cost), 0) AS cost_usd,
    COALESCE(SUM(usage_logs.first_token_ms) FILTER (WHERE usage_logs.first_token_ms IS NOT NULL), 0) AS first_token_sum_ms,
    COUNT(usage_logs.first_token_ms) AS first_token_samples,
    COALESCE(SUM(usage_logs.duration_ms) FILTER (WHERE usage_logs.duration_ms IS NOT NULL), 0) AS duration_sum_ms,
    COUNT(usage_logs.duration_ms) AS duration_samples,
    COALESCE(SUM(usage_logs.output_tokens) FILTER (
      WHERE usage_logs.duration_ms IS NOT NULL
        AND usage_logs.duration_ms > COALESCE(usage_logs.first_token_ms, 0)
    ), 0) AS tps_output_tokens,
    COALESCE(SUM(GREATEST(usage_logs.duration_ms - COALESCE(usage_logs.first_token_ms, 0), 1)) FILTER (
      WHERE usage_logs.duration_ms IS NOT NULL
        AND usage_logs.duration_ms > COALESCE(usage_logs.first_token_ms, 0)
    ), 0) AS generation_duration_ms,
    COUNT(*) FILTER (WHERE usage_logs.openai_ws_mode OR usage_logs.request_type = 3) AS websocket_requests,
    COUNT(*) FILTER (
      WHERE NOT (usage_logs.openai_ws_mode OR usage_logs.request_type = 3)
        AND usage_logs.request_type <> 4
        AND usage_logs.stream
    ) AS stream_requests,
    COUNT(*) FILTER (
      WHERE NOT (usage_logs.openai_ws_mode OR usage_logs.request_type = 3)
        AND usage_logs.request_type <> 4
        AND NOT usage_logs.stream
    ) AS sync_requests,
    COUNT(*) FILTER (
      WHERE NOT (usage_logs.openai_ws_mode OR usage_logs.request_type = 3)
        AND usage_logs.request_type = 4
    ) AS live_requests
  FROM usage_logs
  INNER JOIN users ON users.id = usage_logs.user_id
  WHERE usage_logs.account_id = $1
    AND usage_logs.created_at >= $2::timestamptz
    AND usage_logs.created_at < $3::timestamptz
  GROUP BY usage_logs.user_id, users.email, users.username, usage_logs.model
  ORDER BY cost_usd DESC, requests DESC
`

const ELIGIBLE_USERS_QUERY = `
  SELECT DISTINCT
    users.id AS user_id,
    users.email,
    users.username
  FROM user_subscriptions
  INNER JOIN users ON users.id = user_subscriptions.user_id
  WHERE user_subscriptions.group_id = ANY($1::bigint[])
    AND user_subscriptions.status = 'active'
    AND user_subscriptions.deleted_at IS NULL
    AND users.status = 'active'
    AND users.deleted_at IS NULL
  ORDER BY users.id
`

function numeric(value: string | number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function emptyPrimitives(): UsagePrimitives {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    firstTokenSumMs: 0,
    firstTokenSamples: 0,
    durationSumMs: 0,
    durationSamples: 0,
    tpsOutputTokens: 0,
    generationDurationMs: 0,
    requestTypes: { websocket: 0, stream: 0, sync: 0, live: 0, other: 0 },
  }
}

function primitivesFromRow(row: ModelUsageRow): UsagePrimitives {
  const requests = numeric(row.requests)
  const requestTypes = {
    websocket: numeric(row.websocket_requests),
    stream: numeric(row.stream_requests),
    sync: numeric(row.sync_requests),
    live: numeric(row.live_requests),
    other: 0,
  }
  requestTypes.other = Math.max(0, requests - Object.values(requestTypes).reduce((total, value) => total + value, 0))
  return {
    requests,
    inputTokens: numeric(row.input_tokens),
    outputTokens: numeric(row.output_tokens),
    cacheReadTokens: numeric(row.cache_read_tokens),
    cacheCreationTokens: numeric(row.cache_creation_tokens),
    costUsd: numeric(row.cost_usd),
    firstTokenSumMs: numeric(row.first_token_sum_ms),
    firstTokenSamples: numeric(row.first_token_samples),
    durationSumMs: numeric(row.duration_sum_ms),
    durationSamples: numeric(row.duration_samples),
    tpsOutputTokens: numeric(row.tps_output_tokens),
    generationDurationMs: numeric(row.generation_duration_ms),
    requestTypes,
  }
}

function mergePrimitives(target: UsagePrimitives, source: UsagePrimitives): void {
  target.requests += source.requests
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheCreationTokens += source.cacheCreationTokens
  target.costUsd += source.costUsd
  target.firstTokenSumMs += source.firstTokenSumMs
  target.firstTokenSamples += source.firstTokenSamples
  target.durationSumMs += source.durationSumMs
  target.durationSamples += source.durationSamples
  target.tpsOutputTokens += source.tpsOutputTokens
  target.generationDurationMs += source.generationDurationMs
  target.requestTypes.websocket += source.requestTypes.websocket
  target.requestTypes.stream += source.requestTypes.stream
  target.requestTypes.sync += source.requestTypes.sync
  target.requestTypes.live += source.requestTypes.live
  target.requestTypes.other += source.requestTypes.other
}

function metrics(primitives: UsagePrimitives): UsageAnalyticsMetrics {
  const promptTokens = primitives.inputTokens + primitives.cacheReadTokens
  return {
    requests: primitives.requests,
    inputTokens: primitives.inputTokens,
    outputTokens: primitives.outputTokens,
    cacheReadTokens: primitives.cacheReadTokens,
    cacheCreationTokens: primitives.cacheCreationTokens,
    totalTokens: primitives.inputTokens + primitives.outputTokens + primitives.cacheReadTokens + primitives.cacheCreationTokens,
    costUsd: primitives.costUsd,
    cacheHitRate: promptTokens > 0 ? primitives.cacheReadTokens / promptTokens * 100 : null,
    averageTps: primitives.generationDurationMs > 0 ? primitives.tpsOutputTokens * 1_000 / primitives.generationDurationMs : null,
    averageFirstTokenMs: primitives.firstTokenSamples > 0 ? primitives.firstTokenSumMs / primitives.firstTokenSamples : null,
    averageDurationMs: primitives.durationSamples > 0 ? primitives.durationSumMs / primitives.durationSamples : null,
    requestTypes: primitives.requestTypes,
  }
}

export class AnalyticsRepository {
  private readonly pool: Pool

  constructor(config: AnalyticsDatabaseConfig) {
    this.pool = new Pool({
      ...config,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: 'sub2api-operations-console',
      options: '-c default_transaction_read_only=on',
    })
  }

  async accountAnalytics(input: {
    accountKey: string
    accountId: number
    groupIds: number[]
    range: AnalyticsRange
    cycle?: AnalyticsCycleWindow
  }): Promise<AccountAnalyticsResponse> {
    const window = analyticsWindow(input)
    const { startAt, endAt } = window
    const [usageResult, eligibleUsersResult] = await Promise.all([
      this.pool.query<ModelUsageRow>(MODEL_USAGE_QUERY, [input.accountId, startAt.toISOString(), endAt.toISOString()]),
      this.pool.query<EligibleUserRow>(ELIGIBLE_USERS_QUERY, [input.groupIds]),
    ])
    const accountMetrics = emptyPrimitives()
    const users = new Map<number, UserAccumulator>()

    for (const row of usageResult.rows) {
      const modelMetrics = primitivesFromRow(row)
      const userId = numeric(row.user_id)
      const user = users.get(userId) ?? {
        userId,
        email: row.email,
        username: row.username ?? '',
        metrics: emptyPrimitives(),
        models: [],
      }
      if (!users.has(userId)) users.set(userId, user)
      mergePrimitives(user.metrics, modelMetrics)
      mergePrimitives(accountMetrics, modelMetrics)
      user.models.push({
        model: row.model?.trim() || '未知模型',
        ...metrics(modelMetrics),
      })
    }

    for (const row of eligibleUsersResult.rows) {
      const userId = numeric(row.user_id)
      if (users.has(userId)) continue
      users.set(userId, {
        userId,
        email: row.email,
        username: row.username ?? '',
        metrics: emptyPrimitives(),
        models: [],
      })
    }

    const userAnalytics: AccountUserAnalytics[] = [...users.values()]
      .map((user) => ({
        userId: user.userId,
        email: user.email,
        username: user.username,
        ...metrics(user.metrics),
        models: user.models,
      }))
      .sort((left, right) => right.costUsd - left.costUsd || right.requests - left.requests)

    return {
      accountKey: input.accountKey,
      accountId: input.accountId,
      range: input.range,
      ...(window.cycleResetAt === undefined ? {} : { cycleResetAt: window.cycleResetAt }),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      usersWithUsage: userAnalytics.filter((user) => user.requests > 0).length,
      ...metrics(accountMetrics),
      users: userAnalytics,
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
