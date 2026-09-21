export type JobKind = 'reset' | 'capacity'
export type JobHealth = 'idle' | 'running' | 'healthy' | 'degraded'
export type EventSeverity = 'info' | 'success' | 'warning' | 'error'
export type CapacityReserveMode = 'usd' | 'percent'

export interface AccountConfig {
  key: string
  email: string
  label: string
  shareCount: number
  reserveMode: CapacityReserveMode
  reserveValue: number
  targetGroupIds: number[]
  enabled: boolean
}

export interface ServiceConfig {
  version: 11
  fixedGroupIds: number[]
  resetSync: {
    intervalSeconds: number
    requestTimeoutSeconds: number
    resetAtToleranceSeconds: number
    usageDropTolerancePercent: number
  }
  capacitySync: {
    intervalSeconds: number
    minimumUsedPercent: number
    minimumChangeUsd: number
  }
  promptAudit: {
    maxRequestBodyMiB: number
    normalRetentionDays: number
    riskRetentionDays: number
  }
  userConcurrencySchedule: {
    enabled: boolean
    timezone: string
    peakWindows: Array<{
      start: string
      end: string
    }>
    peakConcurrency: number
    idleConcurrency: number
    peakRpm: number
    idleRpm: number
    exemptUserIds: number[]
  }
  accounts: AccountConfig[]
}

export interface QuotaObservation {
  resetAt: number
  usedPercent: number
  fetchedAt: number
  observedAt: string
}

export interface PendingResetEvent {
  id: string
  detectedAt: string
  previousObservation: QuotaObservation
  observation: QuotaObservation
  targetSubscriptionIds: number[]
  completedSubscriptionIds: number[]
}

export interface ResetCycleSummary {
  /** Unix seconds of the upstream window boundary. */
  resetAt: number
  /** Best-effort start of the seven-day window (resetAt - 7 days). */
  startAt: number
  status: 'current' | 'completed'
  observedAt: string
  usedPercent?: number
  usageUsd?: number
  estimatedCycleCapacityUsd?: number
  reserveUsd?: number
  allocatableCapacityUsd?: number
  perShareUsageUsd?: number
  perShareCapacityUsd?: number
}

export interface ResetRuntime {
  observation?: QuotaObservation
  baselineCreatedAt?: string
  lastHandledResetAt?: number
  lastCompletedEventAt?: string
  pendingEvent?: PendingResetEvent | null
  cycles?: ResetCycleSummary[]
}

export interface GroupAllocation {
  groupId: number
  name: string
  currentLimitUsd: number | null
  targetLimitUsd: number
  rateMultiplier: number
  updated: boolean
  status: 'updated' | 'unchanged' | 'failed'
  error?: string
}

export interface CapacityEstimateSample {
  observedAt: string
  usedPercent: number
  percentBucket: number
  standardCostUsd: number
}

export interface CapacityRuntime {
  observedAt: string
  resetAt: number
  usedPercent: number
  localStandardCostUsd: number
  estimatedCycleCapacityUsd?: number
  reserveUsd?: number
  allocatableCapacityUsd?: number
  perShareCapacityUsd?: number
  shareCount: number
  activeSubscriptions: number
  status: 'updated' | 'unchanged' | 'insufficient-sample' | 'failed'
  message: string
  groups: GroupAllocation[]
  estimationSamples?: CapacityEstimateSample[]
}

export interface AccountRuntime {
  key: string
  email: string
  label: string
  accountId?: number
  resolvedAt?: string
  reset: ResetRuntime
  capacity?: CapacityRuntime
  lastError?: string
  lastErrorAt?: string
  lastErrorJob?: JobKind
}

export interface AccountInfrastructure {
  accountKey: string
  email: string
  accountId?: number
  proxy: null | {
    id: number
    name: string
    status: string
    protocol: string
    endpoint: string
    expiresAt?: string | null
  }
  error?: string
}

export interface JobRuntime {
  kind: JobKind
  health: JobHealth
  running: boolean
  lastStartedAt?: string
  lastCompletedAt?: string
  lastDurationMs?: number
  failures: number
  message: string
  nextRunAt?: string
}

export interface AuditEvent {
  id: string
  createdAt: string
  severity: EventSeverity
  category: 'system' | 'auth' | 'reset' | 'capacity' | 'concurrency' | 'configuration' | 'prompt_audit'
  summary: string
  accountKey?: string
  details?: Record<string, unknown>
}

export interface PersistedState {
  version: 2
  updatedAt: string
  accounts: Record<string, AccountRuntime>
  jobs: Record<JobKind, JobRuntime>
  events: AuditEvent[]
}

export interface DashboardResponse {
  generatedAt: string
  service: {
    health: 'healthy' | 'degraded'
    version: string
    startedAt: string
  }
  config: ServiceConfig
  accounts: AccountRuntime[]
  infrastructure: AccountInfrastructure[]
  jobs: JobRuntime[]
  events: AuditEvent[]
}

export interface SessionUser {
  id: number
  email: string
  username: string
  role: 'admin'
}

export interface BootstrapResponse {
  user: SessionUser
  dashboard: DashboardResponse
}

export interface AuthConfigResponse {
  siteName: string
  turnstileEnabled: boolean
  turnstileSiteKey: string
  githubOAuthEnabled: boolean
  googleOAuthEnabled: boolean
}

export interface SettingsOptionsResponse {
  accounts: Array<{
    id: number
    email: string
    name: string
    status: 'active' | 'inactive' | 'error'
  }>
  groups: Array<{
    id: number
    name: string
    weeklyLimitUsd: number | null
  }>
  users: Array<{
    id: number
    email: string
    username: string
    status: 'active' | 'disabled'
    concurrency: number
    rpmLimit: number
  }>
}

export type AnalyticsRange = 'day' | 'week' | 'month' | 'cycle'

export interface RequestTypeBreakdown {
  websocket: number
  stream: number
  sync: number
  live: number
  other: number
}

export interface UsageAnalyticsMetrics {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
  cacheHitRate: number | null
  averageTps: number | null
  averageFirstTokenMs: number | null
  averageDurationMs: number | null
  requestTypes: RequestTypeBreakdown
}

export interface AccountModelAnalytics extends UsageAnalyticsMetrics {
  model: string
}

export interface AccountUserAnalytics extends UsageAnalyticsMetrics {
  userId: number
  email: string
  username: string
  models: AccountModelAnalytics[]
}

export interface AccountAnalyticsResponse extends UsageAnalyticsMetrics {
  accountKey: string
  accountId: number
  range: AnalyticsRange
  cycleResetAt?: number
  startAt: string
  endAt: string
  usersWithUsage: number
  users: AccountUserAnalytics[]
}

export type PromptAuditRange = 'day' | 'week' | 'month'
export type PromptRiskStatus = 'pending' | 'clear' | 'flagged' | 'error' | 'not_required'
export type PromptCaptureKind = 'user' | 'assistant' | 'developer' | 'function_call' | 'function_call_output' | 'tool' | 'other'
export type PromptAuditUserStatus = 'active' | 'disabled'
export type PromptSessionSource = '' | 'header_session' | 'header_conversation' | 'body_prompt_cache'

export interface PromptAuditRecordSummary {
  id: string
  requestId: string
  userId: number | null
  userEmail: string
  apiKeyId: number | null
  apiKeyName: string
  groupId: number | null
  groupName: string
  model: string
  preview: string
  promptHash: string
  charCount: number
  redacted: boolean
  truncated: boolean
  riskStatus: PromptRiskStatus
  riskCategory: string
  riskScore: number | null
  moderationAction: string
  matchedKeyword: string
  autoBanned: boolean
  fullContentAvailable: boolean
  reviewRequired: boolean
  captureKind: PromptCaptureKind
  sessionFingerprint: string
  sessionSource: PromptSessionSource
  mediaCount: number
  occurrenceCount: number
  userStatus: PromptAuditUserStatus | null
  capturedAt: string
  expiresAt: string
}

export interface PromptAuditRecordDetail extends PromptAuditRecordSummary {
  promptText: string
  media: PromptAuditMedia[]
}

export interface PromptAuditMedia {
  id: number
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  byteSize: number
  sha256: string
  fileName: string
}

export interface PromptAuditTimelinePoint {
  bucket: string
  pending: number
  clear: number
  flagged: number
  error: number
  notRequired: number
}

export interface PromptAuditListResponse {
  generatedAt: string
  range: PromptAuditRange
  page: number
  pageSize: number
  total: number
  totals: {
    records: number
    reviewed: number
    notRequired: number
    pending: number
    clear: number
    flagged: number
    error: number
    users: number
  }
  timeline: PromptAuditTimelinePoint[]
  items: PromptAuditRecordSummary[]
}

export interface PromptAuditFilterOptionsResponse {
  users: Array<{ id: number; email: string }>
  groups: Array<{ id: number; name: string }>
}

export interface PromptAuditSessionResponse {
  fingerprint: string
  startedAt: string
  endedAt: string
  durationMs: number
  totals: {
    records: number
    reviewed: number
    notRequired: number
    pending: number
    flagged: number
    errors: number
  }
  models: Array<{ model: string; records: number }>
  items: PromptAuditRecordSummary[]
}

export interface PromptAuditStorageResponse {
  generatedAt: string
  purgeBefore: string
  logs: {
    records: number
    databaseBytes: number
  }
  images: {
    files: number
    bytes: number
  }
  totalBytes: number
}

export interface PromptAuditPurgeResponse {
  before: string
  deletedRecords: number
  deletedImages: number
  freedImageBytes: number
}

export interface LoginInput {
  email: string
  password: string
  turnstileToken?: string
}

export interface TwoFactorInput {
  tempToken: string
  totpCode: string
}

export interface OAuthTokenInput {
  provider: 'github' | 'google'
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

export type LoginResponse =
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'two-factor-required'; tempToken: string; maskedEmail: string }
