import { beforeEach, describe, expect, it } from 'vitest'

import { beginOAuth, consumeOAuthCallback } from './oauth'

describe('OAuth callback bridge', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/ops/')
  })

  it('从 fragment 读取凭据并立即清理地址栏', () => {
    beginOAuth('github')
    window.history.replaceState(null, '', '/ops/auth/callback#access_token=access-123&refresh_token=refresh-456&expires_in=3600')

    expect(consumeOAuthCallback()).toEqual({
      kind: 'tokens',
      input: {
        provider: 'github',
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresIn: 3_600,
      },
    })
    expect(window.location.pathname).toBe('/ops/')
    expect(window.location.hash).toBe('')
  })

  it('未绑定账号时不把 pending 流程当成登录成功', () => {
    beginOAuth('google')
    window.history.replaceState(null, '', '/ops/auth/callback')

    expect(consumeOAuthCallback()).toEqual(expect.objectContaining({ kind: 'error' }))
  })
})
