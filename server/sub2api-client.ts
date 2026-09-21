import type {
  AccountConfig,
  AccountInfrastructure,
  PromptAuditFilterOptionsResponse,
  SessionUser,
  SettingsOptionsResponse,
} from '../shared/contracts.js'

interface Envelope<T> {
  code: number
  message: string
  reason?: string
  data?: T
}

interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface UpstreamUser {
  id: number
  email: string
  username: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  concurrency: number
  rpm_limit: number
}

export interface TokenPair {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type: string
  user: UpstreamUser
}

export interface RefreshPair {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

export interface TwoFactorChallenge {
  requires_2fa: true
  temp_token: string
  user_email_masked: string
}

export interface OpenAIAccount {
  id: number
  name: string
  status: 'active' | 'inactive' | 'error'
  credentials?: Record<string, unknown>
  extra?: Record<string, unknown>
  proxy_id?: number | null
  proxy?: {
    id: number
    name: string
    status: string
    protocol: string
    host: string
    port: number
    expires_at?: string | null
  } | null
}

export interface QuotaWindow {
  used_percent: number
  reset_at: number
}

export interface OpenAIQuota {
  rate_limit?: {
    primary_window?: QuotaWindow | null
  } | null
  fetched_at: number
}

export interface AccountUsage {
  seven_day?: {
    utilization: number
    resets_at: string | null
    window_stats?: {
      standard_cost?: number
    } | null
  } | null
}

export interface AdminGroup {
  id: number
  name: string
  rate_multiplier: number
  daily_limit_usd: number | null
  weekly_limit_usd: number | null
  monthly_limit_usd: number | null
}

export interface UserSubscription {
  id: number
  group_id: number
  status: 'active' | 'expired' | 'revoked' | 'suspended'
}

export interface PublicSettings {
  site_name: string
  turnstile_enabled: boolean
  turnstile_site_key: string
  github_oauth_enabled: boolean
  google_oauth_enabled: boolean
}

export class Sub2ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message)
    this.name = 'Sub2ApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asEnvelope<T>(value: unknown): Envelope<T> {
  if (!isRecord(value) || typeof value.code !== 'number' || typeof value.message !== 'string') {
    throw new Sub2ApiError('sub2api 返回了无法识别的响应', 502)
  }
  return value as unknown as Envelope<T>
}

function accountEmail(account: OpenAIAccount): string {
  return [account.credentials?.email, account.extra?.email, account.name]
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.includes('@')) ?? account.name
}

function maskedEndpoint(host: string, port: number): string {
  const ipv4 = host.split('.')
  if (ipv4.length === 4) return `${ipv4[0]}.${ipv4[1]}.•.${ipv4[3]}:${port}`
  if (host.length <= 8) return `${host}:${port}`
  return `${host.slice(0, 4)}…${host.slice(-4)}:${port}`
}

export class Sub2ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly adminApiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async publicSettings(): Promise<PublicSettings> {
    return this.request<PublicSettings>('/settings/public')
  }

  async login(input: { email: string; password: string; turnstile_token?: string }): Promise<TokenPair | TwoFactorChallenge> {
    return this.request<TokenPair | TwoFactorChallenge>('/auth/login', { method: 'POST', body: input })
  }

  async login2fa(input: { temp_token: string; totp_code: string }): Promise<TokenPair> {
    return this.request<TokenPair>('/auth/login/2fa', { method: 'POST', body: input })
  }

  async refresh(refreshToken: string): Promise<RefreshPair> {
    return this.request<RefreshPair>('/auth/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    })
  }

  async currentUser(accessToken: string): Promise<UpstreamUser> {
    return this.request<UpstreamUser>('/auth/me', { accessToken })
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    await this.request('/auth/logout', {
      method: 'POST',
      body: refreshToken ? { refresh_token: refreshToken } : {},
    })
  }

  oauthStartPath(provider: 'github' | 'google'): string {
    const apiPath = new URL(this.baseUrl).pathname.replace(/\/$/, '')
    const query = new URLSearchParams({ redirect: '/dashboard' })
    return `${apiPath}/auth/oauth/${provider}/start?${query.toString()}`
  }

  async resolveOpenAIAccount(email: string): Promise<OpenAIAccount> {
    const query = new URLSearchParams({ page: '1', page_size: '50', platform: 'openai', search: email })
    const result = await this.adminRequest<Paginated<OpenAIAccount>>(`/admin/accounts?${query.toString()}`)
    const normalized = email.toLowerCase()
    const exact = result.items.filter((account) => {
      const candidates = [account.name, account.credentials?.email, account.extra?.email]
      return candidates.some((candidate) => typeof candidate === 'string' && candidate.toLowerCase() === normalized)
    })
    if (exact.length === 1) return exact[0]!
    if (result.items.length === 1) return result.items[0]!
    if (exact.length > 1) throw new Error(`OpenAI 账号邮箱不唯一: ${email}`)
    throw new Error(`未找到 OpenAI 账号: ${email}`)
  }

  async settingsOptions(): Promise<SettingsOptionsResponse> {
    const [accounts, groups, users] = await Promise.all([
      this.paginate<OpenAIAccount>('/admin/accounts', { platform: 'openai' }),
      this.paginate<AdminGroup>('/admin/groups'),
      this.users(),
    ])
    return {
      accounts: accounts.map((account) => {
        return {
          id: account.id,
          email: accountEmail(account),
          name: account.name,
          status: account.status,
        }
      }),
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        weeklyLimitUsd: group.weekly_limit_usd,
      })),
      users: users
        .map((user) => ({
          id: user.id,
          email: user.email,
          username: user.username,
          status: user.status,
          concurrency: user.concurrency,
          rpmLimit: user.rpm_limit,
        }))
        .sort((left, right) => left.email.localeCompare(right.email)),
    }
  }

  async users(): Promise<UpstreamUser[]> {
    return this.paginate<UpstreamUser>('/admin/users')
  }

  async batchSetUserLimits(
    userIds: number[],
    limits: { concurrency: number; rpmLimit: number },
  ): Promise<number> {
    let affected = 0
    for (let offset = 0; offset < userIds.length; offset += 500) {
      const batch = userIds.slice(offset, offset + 500)
      const result = await this.adminRequest<{ affected: number }>('/admin/users/batch-limits', {
        method: 'POST',
        body: {
          user_ids: batch,
          all: false,
          concurrency: limits.concurrency,
          rpm_limit: limits.rpmLimit,
        },
      })
      affected += result.affected
    }
    return affected
  }

  async promptAuditFilterOptions(): Promise<PromptAuditFilterOptionsResponse> {
    const [users, groups] = await Promise.all([
      this.paginate<UpstreamUser>('/admin/users'),
      this.paginate<AdminGroup>('/admin/groups'),
    ])
    return {
      users: users
        .map((user) => ({ id: user.id, email: user.email }))
        .sort((left, right) => left.email.localeCompare(right.email)),
      groups: groups
        .map((group) => ({ id: group.id, name: group.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }
  }

  async accountInfrastructure(configuredAccounts: AccountConfig[]): Promise<AccountInfrastructure[]> {
    const accounts = await this.paginate<OpenAIAccount>('/admin/accounts', { platform: 'openai' })
    return configuredAccounts.map((configured) => {
      const normalizedEmail = configured.email.toLowerCase()
      const account = accounts.find((candidate) => accountEmail(candidate).toLowerCase() === normalizedEmail)
      if (!account) {
        return { accountKey: configured.key, email: configured.email, proxy: null, error: '未找到 sub2api OpenAI 账号' }
      }
      if (!account.proxy) {
        return { accountKey: configured.key, email: configured.email, accountId: account.id, proxy: null }
      }
      return {
        accountKey: configured.key,
        email: configured.email,
        accountId: account.id,
        proxy: {
          id: account.proxy.id,
          name: account.proxy.name,
          status: account.proxy.status,
          protocol: account.proxy.protocol,
          endpoint: maskedEndpoint(account.proxy.host, account.proxy.port),
          ...(account.proxy.expires_at === undefined ? {} : { expiresAt: account.proxy.expires_at }),
        },
      }
    })
  }

  async openAIQuota(accountId: number): Promise<OpenAIQuota> {
    return this.adminRequest<OpenAIQuota>(`/admin/openai/accounts/${accountId}/quota`)
  }

  async accountUsage(accountId: number): Promise<AccountUsage> {
    return this.adminRequest<AccountUsage>(`/admin/accounts/${accountId}/usage`)
  }

  async group(groupId: number): Promise<AdminGroup> {
    return this.adminRequest<AdminGroup>(`/admin/groups/${groupId}`)
  }

  async updateGroupWeeklyLimit(group: AdminGroup, weeklyLimitUsd: number): Promise<AdminGroup> {
    return this.adminRequest<AdminGroup>(`/admin/groups/${group.id}`, {
      method: 'PUT',
      body: {
        daily_limit_usd: group.daily_limit_usd ?? -1,
        weekly_limit_usd: weeklyLimitUsd,
        monthly_limit_usd: group.monthly_limit_usd ?? -1,
      },
    })
  }

  async activeSubscriptions(groupIds: number[]): Promise<UserSubscription[]> {
    const wanted = new Set(groupIds)
    const found: UserSubscription[] = []
    let page = 1
    do {
      const query = new URLSearchParams({ page: String(page), page_size: '100', status: 'active' })
      const result = await this.adminRequest<Paginated<UserSubscription>>(`/admin/subscriptions?${query.toString()}`)
      found.push(...result.items.filter((subscription) => wanted.has(subscription.group_id)))
      if (page >= result.pages) break
      page += 1
    } while (true)
    return found
  }

  async resetSubscriptionWeekly(subscriptionId: number): Promise<void> {
    await this.adminRequest(`/admin/subscriptions/${subscriptionId}/reset-quota`, {
      method: 'POST',
      body: { daily: false, weekly: true, monthly: false },
    })
  }

  async unbanRiskControlledUser(userId: number): Promise<void> {
    await this.adminRequest(`/admin/risk-control/users/${userId}/unban`, { method: 'POST' })
  }

  async userRequest<T>(path: string, accessToken: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    return this.request<T>(path, { ...init, accessToken })
  }

  private async adminRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    return this.request<T>(path, { ...init, admin: true })
  }

  private async paginate<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const items: T[] = []
    let page = 1
    do {
      const query = new URLSearchParams({ ...params, page: String(page), page_size: '100' })
      const result = await this.adminRequest<Paginated<T>>(`${path}?${query.toString()}`)
      items.push(...result.items)
      if (page >= result.pages) break
      page += 1
    } while (true)
    return items
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; admin?: boolean; accessToken?: string } = {},
  ): Promise<T> {
    const headers = new Headers({ accept: 'application/json' })
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    if (init.admin) headers.set('x-api-key', this.adminApiKey)
    if (init.accessToken) headers.set('authorization', `Bearer ${init.accessToken}`)

    let response: Response
    try {
      response = await fetch(new URL(path.replace(/^\//, ''), `${this.baseUrl.replace(/\/$/, '')}/`), {
        method: init.method ?? 'GET',
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new Sub2ApiError(`无法连接 sub2api: ${(error as Error).message}`, 502)
    }

    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw new Sub2ApiError(`sub2api 返回 HTTP ${response.status}`, response.status)
    }
    const envelope = asEnvelope<T>(json)
    if (!response.ok || envelope.code !== 0) {
      throw new Sub2ApiError(envelope.message || `sub2api 返回 HTTP ${response.status}`, response.status, envelope.reason)
    }
    return envelope.data as T
  }
}
