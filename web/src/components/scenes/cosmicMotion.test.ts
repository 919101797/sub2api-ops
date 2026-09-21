import { describe, expect, it } from 'vitest'
import { cosmicAtmosphere } from './cosmicMotion'

describe('宇宙主题叙事', () => {
  it('整页受光有明确的深空、爆发与冷却阶段，所有边界连续', () => {
    expect(cosmicAtmosphere('moon', 0.64).light).toBeLessThan(cosmicAtmosphere('moon', 0.34).light)
    expect(cosmicAtmosphere('galaxy', 0.55).light).toBeGreaterThan(cosmicAtmosphere('galaxy', 0).light)
    for (let i = 0; i <= 100; i++) {
      expect(cosmicAtmosphere('galaxy', i / 100).light).toBeLessThanOrEqual(0.6)
      expect(cosmicAtmosphere('galaxy', i / 100).warmth).toBeLessThanOrEqual(0.25)
    }
    expect(cosmicAtmosphere('galaxy', 1).warmth).toBeLessThan(0.15)
    for (const style of ['moon', 'galaxy', 'nebula'] as const) {
      let previous = cosmicAtmosphere(style, 0)
      for (let i = 1; i <= 1000; i++) {
        const next = cosmicAtmosphere(style, i / 1000)
        expect(Math.abs(next.light - previous.light)).toBeLessThan(0.04)
        expect(Math.abs(next.warmth - previous.warmth)).toBeLessThan(0.04)
        previous = next
      }
    }
  })
})
