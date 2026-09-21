// @vitest-environment node

import { describe, expect, it } from 'vitest'

import type { QuotaObservation } from '../../shared/contracts.js'
import {
  appendDistinctCapacitySample,
  estimateCapacity,
  estimateCapacityFromSamples,
  isNewResetWindow,
  isSameResetWindow,
  roundUsd,
} from './estimation.js'

function observation(resetAt: number, usedPercent: number, fetchedAt = 1_000): QuotaObservation {
  return { resetAt, usedPercent, fetchedAt, observedAt: new Date(fetchedAt * 1_000).toISOString() }
}

describe('estimateCapacity', () => {
  it('reproduces the validated 163.com estimate', () => {
    expect(estimateCapacity(1157.81, 66, 3, { mode: 'usd', value: 140 })).toEqual({
      cycleCapacityUsd: 1754.26,
      reserveUsd: 140,
      allocatableCapacityUsd: 1614.26,
      perShareCapacityUsd: 538.09,
    })
  })

  it('reproduces the validated Gmail estimate', () => {
    expect(estimateCapacity(966.12, 42, 3, { mode: 'usd', value: 140 })).toEqual({
      cycleCapacityUsd: 2300.29,
      reserveUsd: 140,
      allocatableCapacityUsd: 2160.29,
      perShareCapacityUsd: 720.1,
    })
  })

  it('reserves capacity before splitting the distributable amount', () => {
    expect(estimateCapacity(1_500, 50, 3, { mode: 'usd', value: 300 })).toEqual({
      cycleCapacityUsd: 3_000,
      reserveUsd: 300,
      allocatableCapacityUsd: 2_700,
      perShareCapacityUsd: 900,
    })
    expect(estimateCapacity(50, 50, 3, { mode: 'usd', value: 140 }).perShareCapacityUsd).toBe(0)
  })

  it('场景-003-07：按周期容量百分比计算实际预留金额', () => {
    expect(estimateCapacity(1_500, 50, 3, { mode: 'percent', value: 12.5 })).toEqual({
      cycleCapacityUsd: 3_000,
      reserveUsd: 375,
      allocatableCapacityUsd: 2_625,
      perShareCapacityUsd: 875,
    })
  })

  it('uses currency-safe rounding and rejects invalid inputs', () => {
    expect(roundUsd(10.005)).toBe(10.01)
    expect(() => estimateCapacity(10, 0, 3, { mode: 'usd', value: 140 })).toThrow()
    expect(() => estimateCapacity(-1, 50, 3, { mode: 'usd', value: 140 })).toThrow()
    expect(() => estimateCapacity(10, 50, 0, { mode: 'usd', value: 140 })).toThrow()
    expect(() => estimateCapacity(10, 50, 3, { mode: 'usd', value: -1 })).toThrow()
    expect(() => estimateCapacity(10, 50, 3, { mode: 'percent', value: 101 })).toThrow()
  })
})

describe('rolling capacity estimate', () => {
  it('keeps the first sample from each integer percentage bucket', () => {
    const first = appendDistinctCapacitySample([], 116.74, 5, '2026-08-20T15:29:00.000Z')
    const sameBucket = appendDistinctCapacitySample(first, 126.63, 5, '2026-08-20T15:39:00.000Z')
    const nextBucket = appendDistinctCapacitySample(sameBucket, 140, 6, '2026-08-20T15:49:00.000Z')
    expect(sameBucket).toEqual(first)
    expect(nextBucket.map((sample) => sample.percentBucket)).toEqual([5, 6])
    expect(nextBucket[0]!.standardCostUsd).toBe(116.74)
  })

  it('uses the median of recent distinct-percentage estimates', () => {
    const samples = [
      { observedAt: '1', usedPercent: 5, percentBucket: 5, standardCostUsd: 120 },
      { observedAt: '2', usedPercent: 6, percentBucket: 6, standardCostUsd: 150 },
      { observedAt: '3', usedPercent: 7, percentBucket: 7, standardCostUsd: 168 },
    ]
    expect(estimateCapacityFromSamples(samples, 3, { mode: 'usd', value: 120 })).toEqual({
      cycleCapacityUsd: 2_400,
      reserveUsd: 120,
      allocatableCapacityUsd: 2_280,
      perShareCapacityUsd: 760,
    })
  })

  it('estimates immediately from the first eligible sample and smooths subsequent buckets', () => {
    expect(estimateCapacityFromSamples([
      { observedAt: '1', usedPercent: 5, percentBucket: 5, standardCostUsd: 120 },
    ], 3, { mode: 'usd', value: 120 })).toEqual({
      cycleCapacityUsd: 2_400,
      reserveUsd: 120,
      allocatableCapacityUsd: 2_280,
      perShareCapacityUsd: 760,
    })
    expect(estimateCapacityFromSamples([
      { observedAt: '1', usedPercent: 5, percentBucket: 5, standardCostUsd: 120 },
      { observedAt: '2', usedPercent: 6, percentBucket: 6, standardCostUsd: 150 },
    ], 3, { mode: 'usd', value: 120 })).toEqual({
      cycleCapacityUsd: 2_450,
      reserveUsd: 120,
      allocatableCapacityUsd: 2_330,
      perShareCapacityUsd: 776.67,
    })
    expect(() => estimateCapacityFromSamples([], 3, { mode: 'usd', value: 120 })).toThrow('至少需要 1 个使用率样本')
  })
})

describe('isNewResetWindow', () => {
  it('detects a moved reset time with a clear utilization drop', () => {
    expect(isNewResetWindow(observation(900, 68), observation(1_700, 2), 300, 0.5)).toBe(true)
  })

  it('detects a naturally expired previous window even if utilization did not fall yet', () => {
    expect(isNewResetWindow(observation(900, 2), observation(1_700, 2, 1_000), 300, 0.5)).toBe(true)
  })

  it('ignores reset_at jitter and a moved time without corroborating evidence', () => {
    expect(isNewResetWindow(observation(1_200, 50), observation(1_450, 10), 300, 0.5)).toBe(false)
    expect(isNewResetWindow(observation(1_200, 50, 500), observation(2_000, 50, 600), 300, 0.5)).toBe(false)
  })
})

describe('isSameResetWindow', () => {
  it('keeps reset_at jitter inside the configured reset window', () => {
    expect(isSameResetWindow(1_787_801_340, 1_787_801_349, 300)).toBe(true)
    expect(isSameResetWindow(1_787_801_340, 1_787_801_641, 300)).toBe(false)
  })
})
