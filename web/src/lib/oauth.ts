import type { OAuthTokenInput } from '@shared/contracts'

const oauthAttemptKey = 'sub2api_ops_oauth_attempt'

export type OAuthCallback =
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'tokens'; input: OAuthTokenInput }

export function beginOAuth(provider: OAuthTokenInput['provider']): void {
  window.sessionStorage.setItem(oauthAttemptKey, provider)
}

export function consumeOAuthCallback(): OAuthCallback {
  const callbackSuffix = '/auth/callback'
  if (!window.location.pathname.endsWith(callbackSuffix)) return { kind: 'none' }

  const provider = window.sessionStorage.getItem(oauthAttemptKey)
  if (provider !== 'github' && provider !== 'google') {
    window.location.replace(`/auth/oauth/callback${window.location.search}${window.location.hash}`)
    return { kind: 'none' }
  }
  window.sessionStorage.removeItem(oauthAttemptKey)
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const basePath = `${window.location.pathname.slice(0, -callbackSuffix.length).replace(/\/$/, '')}/`
  window.history.replaceState(null, '', basePath)
  const upstreamError = fragment.get('error_description') || fragment.get('error_message') || fragment.get('error')
  if (upstreamError) return { kind: 'error', message: `OAuth 登录失败：${upstreamError}` }

  const accessToken = fragment.get('access_token')?.trim()
  if (!accessToken) {
    return {
      kind: 'error',
      message: `该 ${provider === 'github' ? 'GitHub' : 'Google'} 身份尚未关联已有的 sub2api 账号，请先在 sub2api 完成账号绑定`,
    }
  }

  const refreshToken = fragment.get('refresh_token')?.trim()
  const rawExpiresIn = Number.parseInt(fragment.get('expires_in') ?? '', 10)
  return {
    kind: 'tokens',
    input: {
      provider,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(Number.isSafeInteger(rawExpiresIn) && rawExpiresIn > 0 ? { expiresIn: rawExpiresIn } : {}),
    },
  }
}
