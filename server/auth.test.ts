// @vitest-environment node

import type { FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import { AuthService } from './auth.js'
import { Sub2ApiClient, Sub2ApiError, type UpstreamUser } from './sub2api-client.js'
import { StateStore } from './store.js'

function requestWithSession() {
  const set = vi.fn()
  return {
    request: { session: { set } } as unknown as FastifyRequest,
    set,
  }
}

function serviceFor(user: UpstreamUser) {
  const currentUser = vi.fn(async () => user)
  const addEvent = vi.fn(async () => undefined)
  const client = { currentUser } as unknown as Sub2ApiClient
  const store = { addEvent } as unknown as StateStore
  return { service: new AuthService(client, store), currentUser, addEvent }
}

const tokenInput = {
  provider: 'github' as const,
  accessToken: 'access-token-with-enough-length',
  refreshToken: 'refresh-token-with-enough-length',
  expiresIn: 3_600,
}

describe('AuthService OAuth login', () => {
  it('为启用中的 sub2api 管理员建立加密会话', async () => {
    const { request, set } = requestWithSession()
    const { service, addEvent } = serviceFor({
      id: 7,
      email: 'admin@example.com',
      username: 'admin',
      role: 'admin',
      status: 'active',
      concurrency: 5,
      rpm_limit: 0,
    })

    await expect(service.loginOAuth(request, tokenInput)).resolves.toEqual({
      status: 'authenticated',
      user: { id: 7, email: 'admin@example.com', username: 'admin', role: 'admin' },
    })
    expect(set).toHaveBeenCalledWith('auth', expect.objectContaining({
      accessToken: tokenInput.accessToken,
      refreshToken: tokenInput.refreshToken,
      user: expect.objectContaining({ role: 'admin' }),
    }))
    expect(addEvent).toHaveBeenCalledWith(expect.objectContaining({ category: 'auth' }))
  })

  it.each([
    { role: 'user' as const, status: 'active' as const },
    { role: 'admin' as const, status: 'disabled' as const },
  ])('拒绝非管理员或已停用管理员: $role/$status', async ({ role, status }) => {
    const { request, set } = requestWithSession()
    const { service } = serviceFor({ id: 9, email: 'blocked@example.com', username: 'blocked', role, status, concurrency: 5, rpm_limit: 0 })

    await expect(service.loginOAuth(request, tokenInput)).rejects.toEqual(
      expect.objectContaining<Partial<Sub2ApiError>>({ status: 403 }),
    )
    expect(set).not.toHaveBeenCalled()
  })
})

describe('Sub2ApiClient OAuth start path', () => {
  it('使用当前 sub2api API 路径且只生成同源地址', () => {
    const client = new Sub2ApiClient('http://sub2api:8080/api/v1', 'admin-key', 5_000)
    expect(client.oauthStartPath('google')).toBe('/api/v1/auth/oauth/google/start?redirect=%2Fdashboard')
  })
})
