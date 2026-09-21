import { describe, expect, it, vi } from 'vitest'
import { drawMoon } from './moonJourney'
import type { MotionState, Palette } from './types'

const images = vi.hoisted(() => Object.fromEntries(['moon', 'earth', 'ground', 'change', 'palace', 'rocket', 'cloud'].map(name => [name, { name, complete: true, naturalWidth: 1536, naturalHeight: 1024 }])))
vi.mock('./cosmicTextures', () => ({
  hash: () => 0.5,
  getMoonTexture: () => images.moon,
  getEarthTexture: () => images.earth,
  getGroundTexture: () => images.ground,
  getChangeTexture: () => images.change,
  getPalaceTexture: () => images.palace,
  getRocketTexture: () => images.rocket,
  getMoonCloudTexture: () => images.cloud,
}))

const palette: Palette = { dark: true, accent: [176, 202, 210], secondary: [113, 170, 194], tertiary: [232, 231, 214], ink: [244, 244, 241] }
function paint(progress: number, width = 1600, height = 1000, dark = true) {
  let alpha = 1
  const stack: number[] = []
  const drawn: string[] = []
  const context = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'globalAlpha') return alpha
      if (key === 'save') return () => stack.push(alpha)
      if (key === 'restore') return () => { alpha = stack.pop()! }
      if (key === 'drawImage') return (image: { name: string }, ...coordinates: number[]) => {
        expect(coordinates.every(Number.isFinite)).toBe(true)
        if (alpha > 0.01) drawn.push(image.name === 'rocket' && coordinates.length === 8 && coordinates[1] === 190 && coordinates[3] === 660 ? 'cabin' : image.name)
      }
      if (String(key).includes('Gradient')) return () => ({ addColorStop() {} })
      return () => {}
    },
    set: (_target, key, value) => { if (key === 'globalAlpha') alpha = value; return true },
  }) as CanvasRenderingContext2D
  const motion: MotionState = { x: 0.6, y: 0.4, targetX: 0.6, targetY: 0.4, focus: false, energy: 0.3, eclipse: 0.46, sceneProgress: progress }
  drawMoon(context, motion, width, height, 0, { ...palette, dark })
  expect(stack).toHaveLength(0)
  expect(alpha).toBe(1)
  return drawn
}

describe('古今奔月画布', () => {
  it('场景-008-33：开场绘制嫦娥与月宫，交接中出现火箭，月面不残留整枚火箭', () => {
    expect(paint(0)).toEqual(expect.arrayContaining(['moon', 'change', 'palace']))
    expect(paint(0)).not.toContain('rocket')
    expect(paint(0.28)).toEqual(expect.arrayContaining(['change', 'cloud']))
    expect(paint(0.31)).toEqual(expect.arrayContaining(['cloud', 'cabin']))
    expect(paint(0.43)).toContain('cabin')
    expect(paint(0.43).filter(name => name === 'rocket')).toHaveLength(4)
    expect(paint(0.43)).not.toContain('change')
    expect(paint(0.74)).not.toContain('rocket')
    expect(paint(0.74)).toContain('cabin')
    expect(paint(1)).toEqual(['earth', 'ground'])
  })
  it.each([true, false])('场景-008-34：明暗模式 %s 在手机和桌面完整绘制各阶段，绘图状态不泄漏', dark => {
    for (const [width, height] of [[390, 844], [1600, 1000]] as const)
      for (let i = 0; i <= 100; i++) paint(i / 100, width, height, dark)
  })
})
