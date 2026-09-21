// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { concurrencyScheduleTarget } from './user-concurrency-schedule.js'

function atSingapore(local: string): Date {
  return new Date(`${local}+08:00`)
}

describe('concurrencyScheduleTarget', () => {
  const schedule = {
    timezone: 'Asia/Singapore',
    peakWindows: [{ start: '11:00', end: '12:00' }, { start: '14:00', end: '17:00' }],
    peakConcurrency: 2,
    idleConcurrency: 7,
    peakRpm: 30,
    idleRpm: 40,
  }

  it.each([
    ['2026-08-26T10:59:59', 7, 'idle'],
    ['2026-08-26T11:00:00', 2, 'peak'],
    ['2026-08-26T11:59:59', 2, 'peak'],
    ['2026-08-26T12:00:00', 7, 'idle'],
    ['2026-08-26T13:59:59', 7, 'idle'],
    ['2026-08-26T14:00:00', 2, 'peak'],
    ['2026-08-26T16:59:59', 2, 'peak'],
    ['2026-08-26T17:00:00', 7, 'idle'],
  ] as const)('maps weekday time %s to concurrency %s', (local, concurrency, period) => {
    expect(concurrencyScheduleTarget(atSingapore(local), schedule)).toEqual({
      concurrency,
      rpmLimit: period === 'peak' ? 30 : 40,
      period,
    })
  })

  it('场景-009-01：按可编辑时区和高峰时段计算', () => {
    expect(concurrencyScheduleTarget(new Date('2026-08-26T00:30:00Z'), {
      ...schedule,
      timezone: 'Asia/Tokyo',
      peakWindows: [{ start: '09:00', end: '10:00' }],
    })).toEqual({ concurrency: 2, rpmLimit: 30, period: 'peak' })
  })

  it('treats weekends as idle even during peak hours', () => {
    expect(concurrencyScheduleTarget(atSingapore('2026-08-29T14:30:00'), schedule)).toEqual({
      concurrency: 7,
      rpmLimit: 40,
      period: 'weekend',
    })
  })

  it('treats a Chinese statutory holiday as idle even during peak hours', () => {
    expect(concurrencyScheduleTarget(atSingapore('2026-10-01T14:30:00'), schedule)).toEqual({
      concurrency: 7,
      rpmLimit: 40,
      period: 'holiday',
    })
  })
})
