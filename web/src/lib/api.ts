import type {
  AccountAnalyticsResponse,
  AnalyticsRange,
  AuthConfigResponse,
  BootstrapResponse,
  DashboardResponse,
  LoginInput,
  LoginResponse,
  OAuthTokenInput,
  PromptAuditFilterOptionsResponse,
  PromptAuditListResponse,
  PromptAuditPurgeResponse,
  PromptAuditRange,
  PromptAuditRecordDetail,
  PromptAuditSessionResponse,
  PromptAuditStorageResponse,
  PromptRiskStatus,
  ServiceConfig,
  SettingsOptionsResponse,
  TwoFactorInput,
} from '@shared/contracts'

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  })
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    if (response.status === 401 && path !== '/bootstrap' && path !== '/auth/login') {
      window.dispatchEvent(new Event('sub2api-ops:unauthorized'))
    }
    throw new ApiError(body.error ?? `请求失败 (${response.status})`, response.status)
  }
  return body as T
}

export const api = {
  authConfig: () => request<AuthConfigResponse>('/auth/config'),
  login: (input: LoginInput) => request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  login2fa: (input: TwoFactorInput) => request<LoginResponse>('/auth/2fa', { method: 'POST', body: JSON.stringify(input) }),
  loginOAuth: (input: OAuthTokenInput) => request<LoginResponse>('/auth/oauth', { method: 'POST', body: JSON.stringify(input) }),
  oauthStartUrl: (provider: OAuthTokenInput['provider']) => `${API_BASE}/auth/oauth/${provider}/start`,
  bootstrap: () => request<BootstrapResponse>('/bootstrap'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: '{}' }),
  dashboard: () => request<DashboardResponse>('/dashboard'),
  accountAnalytics: (accountKey: string, range: AnalyticsRange, cycleResetAt?: number) => {
    const query = new URLSearchParams({ range })
    if (cycleResetAt !== undefined) query.set('cycleResetAt', String(cycleResetAt))
    return request<AccountAnalyticsResponse>(`/accounts/${encodeURIComponent(accountKey)}/analytics?${query.toString()}`)
  },
  prompts: (input: {
    range: PromptAuditRange
    statuses: PromptRiskStatus[]
    userId: number | null
    groupId: number | null
    search: string
    startAt: string | null
    endAt: string | null
    page: number
  }) => {
    const query = new URLSearchParams({
      range: input.range,
      statuses: input.statuses.join(','),
      search: input.search,
      page: String(input.page),
      pageSize: '30',
    })
    if (input.userId !== null) query.set('userId', String(input.userId))
    if (input.groupId !== null) query.set('groupId', String(input.groupId))
    if (input.startAt) query.set('startAt', input.startAt)
    if (input.endAt) query.set('endAt', input.endAt)
    return request<PromptAuditListResponse>(`/prompts?${query.toString()}`)
  },
  promptFilterOptions: () => request<PromptAuditFilterOptionsResponse>('/prompts/filter-options'),
  promptSession: (fingerprint: string) => request<PromptAuditSessionResponse>(`/prompts/sessions/${encodeURIComponent(fingerprint)}`),
  promptDetail: (id: string) => request<PromptAuditRecordDetail>(`/prompts/${encodeURIComponent(id)}`),
  promptMediaUrl: (mediaId: number) => `${API_BASE}/prompts/media/${mediaId}`,
  promptStorage: () => request<PromptAuditStorageResponse>('/prompts/storage'),
  purgePrompts: (input: { scope: 'all' } | { scope: 'before'; before: string }) => request<PromptAuditPurgeResponse>('/prompts/purge', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
  unbanPromptUser: (userId: number) => request<{ ok: true; userId: number }>(`/prompts/users/${userId}/unban`, {
    method: 'POST',
    body: '{}',
  }),
  settingsOptions: () => request<SettingsOptionsResponse>('/settings/options'),
  run: (kind: 'reset' | 'capacity') => request<{ accepted: boolean }>('/run', {
    method: 'POST',
    body: JSON.stringify({ kind }),
  }),
  saveConfig: (config: ServiceConfig) => request<ServiceConfig>('/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  }),
}
