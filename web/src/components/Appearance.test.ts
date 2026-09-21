import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeAppearance } from './Appearance'
beforeEach(() => {
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())
describe('皮肤偏好', () => {
  it.each(['orbital', 'quantum', 'ferrofluid', 'lighttunnel', 'aurora', 'tidal', 'moon', 'galaxy', 'nebula'])('场景-008-17：继续原有的 %s 皮肤选择', (style) => {
    localStorage.setItem('sub2api-ops-appearance-v1', JSON.stringify({ theme: 'dark', style }))
    expect(initializeAppearance()).toEqual({ theme: 'dark', style })
    expect(document.documentElement.dataset.style).toBe(style)
  })
  it('首次进入默认使用深色日蚀', () => {
    expect(initializeAppearance()).toEqual({ theme: 'dark', style: 'orbital' })
  })
})
