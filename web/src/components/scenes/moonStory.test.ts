import { describe, expect, it } from 'vitest'
import { moonStory } from './moonStory'

describe('古今奔月', () => {
  it('场景-008-33：从嫦娥与月宫，经过载人火箭，进入飞船航行和月面回望', () => {
    expect(moonStory(0)).toMatchObject({ myth: 1, rocket: 0, spacecraft: 0, surface: 0 })
    const handoff = moonStory(0.28)
    expect(handoff.myth).toBeGreaterThan(0.1)
    expect(handoff.clouds).toBeGreaterThan(0.95)
    expect(moonStory(0.43)).toMatchObject({ myth: 0, rocket: 1, surface: 0 })
    expect(moonStory(0.57).separation).toBeGreaterThan(0)
    expect(moonStory(0.74)).toMatchObject({ rocket: 0, spacecraft: 1, surface: 0 })
    expect(moonStory(1)).toMatchObject({ myth: 0, rocket: 0, spacecraft: 0, surface: 1, earthrise: 1 })
  })

  it('场景-008-33：古今交接有共同主体，反向经过同一构图，所有边界连续', () => {
    const forward = Array.from({ length: 1001 }, (_, i) => moonStory(i / 1000))
    for (let i = 1; i <= 1000; i++) {
      const frame = forward[i]!
      expect(moonStory(i / 1000)).toEqual(frame)
      for (const key of Object.keys(frame) as Array<keyof typeof frame>) {
        expect(frame[key]).toBeGreaterThanOrEqual(0)
        expect(frame[key]).toBeLessThanOrEqual(1)
        expect(Math.abs(frame[key] - forward[i - 1]![key])).toBeLessThan(0.05)
      }
      if (i >= 200 && i <= 340) expect(frame.myth + frame.vehicle + frame.clouds).toBeGreaterThan(0.85)
    }
    for (let i = 1000; i >= 0; i -= 10) expect(moonStory(i / 1000)).toEqual(forward[i])
  })
})
