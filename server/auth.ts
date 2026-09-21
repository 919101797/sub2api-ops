import type { FastifyReply, FastifyRequest } from 'fastify'

import type { LoginInput, LoginResponse, OAuthTokenInput, SessionUser, TwoFactorInput } from '../shared/contracts.js'
import { Sub2ApiClient, Sub2ApiError, type TokenPair, type UpstreamUser } from './sub2api-client.js'
import { StateStore } from './store.js'

interface AuthSessionData {
  accessToken: string
  refreshToken?: string
  accessExpiresAt?: number
  user: SessionUser
}

declare module '@fastify/secure-session' {
  interface SessionData {
    auth?: AuthSessionData
  }
}

function toAdminUser(user: UpstreamUser): SessionUser {
  if (user.role !== 'admin' || user.status !== 'active') {
    throw new Sub2ApiError('仅 sub2api 管理员可登录运维控制台', 403)
  }
  return { id: user.id, email: user.email, username: user.username, role: 'admin' }
}

function sessionFromTokens(tokens: TokenPair): AuthSessionData {
  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.expires_in ? { accessExpiresAt: Date.now() + tokens.expires_in * 1_000 } : {}),
    user: toAdminUser(tokens.user),
  }
}

export class AuthService {
  constructor(
    private readonly client: Sub2ApiClient,
    private readonly store: StateStore,
  ) {}

  async login(request: FastifyRequest, input: LoginInput): Promise<LoginResponse> {
    const result = await this.client.login({
      email: input.email,
      password: input.password,
      ...(input.turnstileToken ? { turnstile_token: input.turnstileToken } : {}),
    })
    if ('requires_2fa' in result) {
      return {
        status: 'two-factor-required',
        tempToken: result.temp_token,
        maskedEmail: result.user_email_masked,
      }
    }
    const auth = sessionFromTokens(result)
    request.session.set('auth', auth)
    await this.store.addEvent({
      severity: 'info',
      category: 'auth',
      summary: `管理员 ${auth.user.email} 已登录`,
    })
    return { status: 'authenticated', user: auth.user }
  }

  async login2fa(request: FastifyRequest, input: TwoFactorInput): Promise<LoginResponse> {
    const result = await this.client.login2fa({ temp_token: input.tempToken, totp_code: input.totpCode })
    const auth = sessionFromTokens(result)
    request.session.set('auth', auth)
    await this.store.addEvent({
      severity: 'info',
      category: 'auth',
      summary: `管理员 ${auth.user.email} 已通过二次验证登录`,
    })
    return { status: 'authenticated', user: auth.user }
  }

  async loginOAuth(request: FastifyRequest, input: OAuthTokenInput): Promise<LoginResponse> {
    const user = await this.client.currentUser(input.accessToken)
    const auth = sessionFromTokens({
      access_token: input.accessToken,
      ...(input.refreshToken ? { refresh_token: input.refreshToken } : {}),
      ...(input.expiresIn ? { expires_in: input.expiresIn } : {}),
      token_type: 'Bearer',
      user,
    })
    request.session.set('auth', auth)
    await this.store.addEvent({
      severity: 'info',
      category: 'auth',
      summary: `管理员 ${auth.user.email} 已通过 ${input.provider === 'github' ? 'GitHub' : 'Google'} 登录`,
    })
    return { status: 'authenticated', user: auth.user }
  }

  async requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      await this.validate(request)
    } catch (error) {
      request.session.delete()
      const forbidden = error instanceof Sub2ApiError && error.status === 403
      const status = forbidden ? 403 : 401
      await reply.code(status).send({ error: forbidden ? error.message : '登录已失效，请重新登录' })
    }
  }

  sessionUser(request: FastifyRequest): SessionUser {
    const auth = request.session.get('auth')
    if (!auth) throw new Sub2ApiError('未登录', 401)
    return auth.user
  }

  async accessToken(request: FastifyRequest): Promise<string> {
    return (await this.validate(request)).accessToken
  }

  async logout(request: FastifyRequest): Promise<void> {
    const auth = request.session.get('auth')
    request.session.delete()
    if (auth?.refreshToken) {
      await this.client.logout(auth.refreshToken).catch(() => undefined)
    }
  }

  private async validate(request: FastifyRequest): Promise<AuthSessionData> {
    let auth = request.session.get('auth')
    if (!auth) throw new Sub2ApiError('未登录', 401)
    if (auth.accessExpiresAt && auth.accessExpiresAt <= Date.now() + 30_000) {
      auth = await this.refresh(request, auth)
    }
    try {
      const user = toAdminUser(await this.client.currentUser(auth.accessToken))
      auth = { ...auth, user }
      request.session.set('auth', auth)
      return auth
    } catch (error) {
      if (error instanceof Sub2ApiError && error.status === 401 && auth.refreshToken) {
        const refreshed = await this.refresh(request, auth)
        const user = toAdminUser(await this.client.currentUser(refreshed.accessToken))
        const validated = { ...refreshed, user }
        request.session.set('auth', validated)
        return validated
      }
      throw error
    }
  }

  private async refresh(request: FastifyRequest, auth: AuthSessionData): Promise<AuthSessionData> {
    if (!auth.refreshToken) throw new Sub2ApiError('会话无法刷新', 401)
    const pair = await this.client.refresh(auth.refreshToken)
    const refreshed: AuthSessionData = {
      ...auth,
      accessToken: pair.access_token,
      refreshToken: pair.refresh_token,
      accessExpiresAt: Date.now() + pair.expires_in * 1_000,
    }
    request.session.set('auth', refreshed)
    return refreshed
  }
}
