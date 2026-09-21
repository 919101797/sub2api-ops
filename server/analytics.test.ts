// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyticsWindow } from './analytics.js'

describe('analyticsWindow', () => {
  afterEach(() => vi.useRealTimers())

  it('limits the current cycle to the time observed so far', () => {
    const now = new Date('2026-08-19T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const window = analyticsWindow({
      range: 'cycle',
      cycle: { resetAt: Math.floor(new Date('2026-08-20T12:00:00.000Z').getTime() / 1_000), startAt: Math.floor(new Date('2026-08-13T12:00:00.000Z').getTime() / 1_000), status: 'current' },
    })

    expect(window.startAt.toISOString()).toBe('2026-08-13T12:00:00.000Z')
    expect(window.endAt.toISOString()).toBe('2026-08-19T12:00:00.000Z')
    expect(window.cycleResetAt).toBe(Math.floor(new Date('2026-08-20T12:00:00.000Z').getTime() / 1_000))
  })

  it('uses the reset boundary as the end of a completed cycle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'))

    const window = analyticsWindow({
      range: 'cycle',
      cycle: { resetAt: Math.floor(new Date('2026-08-13T12:00:00.000Z').getTime() / 1_000), startAt: Math.floor(new Date('2026-08-06T12:00:00.000Z').getTime() / 1_000), status: 'completed' },
    })

    expect(window.startAt.toISOString()).toBe('2026-08-06T12:00:00.000Z')
    expect(window.endAt.toISOString()).toBe('2026-08-13T12:00:00.000Z')
  })

  it('rejects a cycle with an empty or reversed window', () => {
    expect(() => analyticsWindow({ range: 'cycle' })).toThrow('未提供有效的重置周期')
    expect(() => analyticsWindow({
      range: 'cycle',
      cycle: { resetAt: 100, startAt: 200, status: 'completed' },
    })).toThrow('重置周期时间范围无效')
  })
})
