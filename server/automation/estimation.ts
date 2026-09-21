import type { CapacityEstimateSample, CapacityReserveMode, QuotaObservation } from '../../shared/contracts.js'

export const CAPACITY_ESTIMATE_WINDOW = 5
const MAX_DISTINCT_CAPACITY_SAMPLES = 8

export function isSameResetWindow(leftResetAt: number, rightResetAt: number, toleranceSeconds: number): boolean {
  return Math.abs(leftResetAt - rightResetAt) <= toleranceSeconds
}

export function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export interface CapacityReserve {
  mode: CapacityReserveMode
  value: number
}

export function resolveReserveUsd(cycleCapacityUsd: number, reserve: CapacityReserve): number {
  if (!Number.isFinite(reserve.value) || reserve.value < 0) throw new Error('预留值必须是非负有限数')
  if (reserve.mode === 'percent') {
    if (reserve.value > 100) throw new Error('预留百分比不能大于 100')
    return roundUsd(cycleCapacityUsd * reserve.value / 100)
  }
  return roundUsd(reserve.value)
}

export function estimateCapacity(standardCostUsd: number, usedPercent: number, shareCount: number, reserve: CapacityReserve): {
  cycleCapacityUsd: number
  reserveUsd: number
  allocatableCapacityUsd: number
  perShareCapacityUsd: number
} {
  if (!Number.isFinite(standardCostUsd) || standardCostUsd < 0) throw new Error('周期费用必须是非负有限数')
  if (!Number.isFinite(usedPercent) || usedPercent <= 0) throw new Error('使用率必须大于 0')
  if (!Number.isInteger(shareCount) || shareCount < 1) throw new Error('份数必须是正整数')
  const cycleCapacityUsd = roundUsd(standardCostUsd / (usedPercent / 100))
  const reserveUsd = resolveReserveUsd(cycleCapacityUsd, reserve)
  const allocatableCapacityUsd = roundUsd(Math.max(0, cycleCapacityUsd - reserveUsd))
  return {
    cycleCapacityUsd,
    reserveUsd,
    allocatableCapacityUsd,
    perShareCapacityUsd: roundUsd(allocatableCapacityUsd / shareCount),
  }
}

export function appendDistinctCapacitySample(
  samples: CapacityEstimateSample[],
  standardCostUsd: number,
  usedPercent: number,
  observedAt: string,
): CapacityEstimateSample[] {
  if (!Number.isFinite(standardCostUsd) || standardCostUsd < 0) throw new Error('周期费用必须是非负有限数')
  if (!Number.isFinite(usedPercent) || usedPercent <= 0) return samples
  const percentBucket = Math.floor(usedPercent)
  if (samples.some((sample) => sample.percentBucket === percentBucket)) return samples
  return [
    ...samples,
    { observedAt, usedPercent, percentBucket, standardCostUsd },
  ].slice(-MAX_DISTINCT_CAPACITY_SAMPLES)
}

export function estimateCapacityFromSamples(
  samples: CapacityEstimateSample[],
  shareCount: number,
  reserve: CapacityReserve,
): ReturnType<typeof estimateCapacity> {
  const recent = samples.slice(-CAPACITY_ESTIMATE_WINDOW)
  if (recent.length === 0) throw new Error('至少需要 1 个使用率样本')
  const cycleEstimates = recent
    .map((sample) => sample.standardCostUsd / (sample.usedPercent / 100))
    .sort((left, right) => left - right)
  const middle = Math.floor(cycleEstimates.length / 2)
  const median = cycleEstimates.length % 2 === 1
    ? cycleEstimates[middle]!
    : (cycleEstimates[middle - 1]! + cycleEstimates[middle]!) / 2
  return estimateCapacity(median, 100, shareCount, reserve)
}

export function isNewResetWindow(
  previous: QuotaObservation,
  current: QuotaObservation,
  resetAtToleranceSeconds: number,
  usageDropTolerancePercent: number,
): boolean {
  const resetMoved = current.resetAt > previous.resetAt + resetAtToleranceSeconds
  if (!resetMoved) return false
  const usageDropped = current.usedPercent + usageDropTolerancePercent < previous.usedPercent
  const previousWindowExpired = current.fetchedAt >= previous.resetAt
  return usageDropped || previousWindowExpired
}
