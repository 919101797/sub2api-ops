import { expect, it } from 'vitest'
import { createCosmicTravel } from './cosmicTravel'

it.each([8500, 11200])('场景-008-35/39：%d 毫秒旅程反向先保留动量再减速，最终停稳', (duration) => {
  const travel = createCosmicTravel(0, duration)
  expect(travel.step(0, 40)).toBe(0)
  const first = travel.step(1, 40)
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThan(0.001)
  for (let i = 0; i < 40; i++) travel.step(1, 40)
  const before = travel.value
  const outgoingSpeed = travel.velocity
  travel.step(0, 40)
  expect(travel.value).toBeGreaterThan(before)
  expect(travel.velocity).toBeGreaterThan(0)
  expect(Math.abs(travel.velocity - outgoingSpeed)).toBeLessThan(0.04)
  for (let i = 0; i < 300; i++) travel.step(0, 40)
  expect(travel.value).toBe(0)
  expect(travel.atRest()).toBe(true)
  for (let i = 0; i < 350; i++) travel.step(1, 40)
  expect(travel.value).toBe(1)
  expect(travel.atRest()).toBe(true)
})

it('场景-008-35：不同绘制频率和连续反向不会跳帧或越界', () => {
  const slow = createCosmicTravel(0), fast = createCosmicTravel(0)
  for (let i = 0; i < 100; i++) slow.step(1, 40)
  for (let i = 0; i < 200; i++) fast.step(1, 20)
  expect(Math.abs(slow.value - fast.value)).toBeLessThan(0.004)
  let previous = slow.value
  for (let i = 0; i < 300; i++) {
    const next = slow.step(i % 25 < 12 ? 0 : 1, 40)
    expect(next).toBeGreaterThanOrEqual(0)
    expect(next).toBeLessThanOrEqual(1)
    expect(Math.abs(next - previous)).toBeLessThan(0.006)
    previous = next
  }
})
