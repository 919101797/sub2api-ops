// @vitest-environment node
import { expect, it } from 'vitest'
import { LargeRequestGate } from './guard.js'

it('场景-012-08：通道数可超过 2，仅按配置计数，释放幂等', () => {
  const gate = new LargeRequestGate()
  const releases = Array.from({ length: 5 }, () => gate.acquire(5))
  expect(gate.active).toBe(5)
  expect(() => gate.acquire(5)).toThrow(expect.objectContaining({ status: 429 }))
  releases[0]!(); releases[0]!()
  expect(gate.active).toBe(4)
  const next = gate.acquire(5)
  for (const release of releases) release()
  next()
  expect(gate.active).toBe(0)
})
