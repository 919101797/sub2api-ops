import { expect, it } from 'vitest'
import { moonFrame, lunarHorizon } from './moonFrame'

it.each([[390, 844], [1600, 1000]] as const)('场景-008-36：%s 像素下古今交接的月亮保持尺寸，所有镜头没有位置跳变', (w, h) => {
  const ancient = moonFrame(0.22, w, h), modern = moonFrame(0.38, w, h)
  expect(modern.moon).toEqual(ancient.moon)
  let previous = moonFrame(0, w, h)
  for (let i = 1; i <= 1000; i++) {
    const current = moonFrame(i / 1000, w, h)
    expect(Math.hypot(current.traveler.x - previous.traveler.x, current.traveler.y - previous.traveler.y)).toBeLessThan(h * 0.004)
    expect(Math.abs(current.vehicleLength - previous.vehicleLength)).toBeLessThan(h * 0.006)
    previous = current
  }
})

it('场景-008-36：原舱段分离后保留同一坐标投影，月表沿球面地平线显现', () => {
  const before = moonFrame(0.63, 1600, 1000), after = moonFrame(0.631, 1600, 1000)
  expect(Math.hypot(after.traveler.x - before.traveler.x, after.traveler.y - before.traveler.y)).toBeLessThan(3)
  for (const p of [0.86, 0.9, 0.95, 1]) {
    const frame = moonFrame(p, 1600, 1000)
    expect(lunarHorizon(frame.moon, frame.moon.x)).toBeCloseTo(frame.moon.y - frame.moon.radius)
    expect(lunarHorizon(frame.moon, 0)).toBeLessThan(1000)
    expect(lunarHorizon(frame.moon, 1600)).toBeLessThan(1000)
  }
})
