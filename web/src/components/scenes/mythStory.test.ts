import { expect, it } from 'vitest'
import { creationStory, mendingStory, mendingStar, repairAt, mythFrame, creationDust } from './mythStory'

it('场景-008-37：微光聚拢后云纱绽开，最后舒展为星河，人物只短暂隐约可见', () => {
  expect(creationStory(0).bloom).toBe(0)
  expect(creationStory(0.26).gather).toBeGreaterThan(0.8)
  expect(creationStory(0.26).bloom).toBeLessThan(0.05)
  expect(creationStory(0.55).bloom).toBeGreaterThan(0.3)
  expect(creationStory(1)).toMatchObject({ figure: 0, galaxy: 1 })
  for (let i = 0; i <= 100; i++) expect(creationStory(i / 100).figure).toBeLessThanOrEqual(0.14)
})

it('场景-008-38：托星、炼石、织补有先后，裂口沿光丝抵达方向闭合', () => {
  expect(mendingStory(0).figure).toBe(0)
  expect(mendingStory(0.35).figure).toBeGreaterThan(0.7)
  expect(repairAt(0.3, 0.38)).toBe(0)
  expect(repairAt(0.1, 0.7)).toBeGreaterThan(repairAt(0.9, 0.7))
  expect(mendingStory(1)).toMatchObject({ figure: 0, restored: 1 })
  for (let i = 0; i < 48; i++) {
    expect(Math.hypot(mendingStar(i, 0.38).x + 0.24, mendingStar(i, 0.38).y + 0.18)).toBeLessThan(0.2)
    expect(mendingStar(i, 1).arrived).toBe(1)
  }
})

it('场景-008-37/38：同一星尘跨越所有交接点无跳变，反向取样严格沿原路径', () => {
  for (const sample of [creationDust, mendingStar]) for (let id = 0; id < 48; id++) {
    const forward = Array.from({ length: 1001 }, (_, i) => sample(id, i / 1000))
    for (let i = 1; i < forward.length; i++) {
      const a = forward[i - 1]!, b = forward[i]!
      expect(Number.isFinite(b.x + b.y)).toBe(true)
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.055)
      expect(sample(id, i / 1000)).toEqual(b)
    }
    for (const p of [0.18, 0.32, 0.42, 0.58, 0.72, 0.88]) {
      const a = sample(id, p - 0.00001), b = sample(id, p + 0.00001)
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.001)
    }
  }
})

it('场景-008-40：窄屏与桌面构图中的叙事锚点始终留在视口内', () => {
  for (const style of ['galaxy', 'nebula'] as const) for (const [w, h] of [[390, 844], [1024, 1000], [1600, 1000]]) {
    let previous = mythFrame(style, 0, w!, h!)
    for (let i = 1; i <= 1000; i++) {
      const frame = mythFrame(style, i / 1000, w!, h!)
      expect(frame.x).toBeGreaterThan(w! * 0.45)
      expect(frame.x).toBeLessThan(w! * 0.9)
      expect(frame.y).toBeGreaterThan(0)
      expect(frame.y).toBeLessThan(h! * 0.65)
      expect(Math.abs(frame.scale - previous.scale)).toBeLessThan(0.004)
      previous = frame
    }
  }
})
