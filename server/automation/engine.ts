import { randomUUID } from 'node:crypto'

import type {
  AccountConfig,
  CapacityEstimateSample,
  CapacityRuntime,
  JobKind,
  PendingResetEvent,
  QuotaObservation,
  ResetCycleSummary,
  ServiceConfig,
} from '../../shared/contracts.js'
import type { AdminGroup } from '../sub2api-client.js'
import { Sub2ApiClient } from '../sub2api-client.js'
import { StateStore } from '../store.js'
import {
  appendDistinctCapacitySample,
  CAPACITY_ESTIMATE_WINDOW,
  estimateCapacityFromSamples,
  isNewResetWindow,
  isSameResetWindow,
  resolveReserveUsd,
} from './estimation.js'
import { concurrencyScheduleTarget } from './user-concurrency-schedule.js'

function nowIso(): string {
  return new Date().toISOString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60
const MAX_CYCLE_HISTORY = 8
const USER_CONCURRENCY_INTERVAL_MS = 60_000

interface StableCapacityEstimate {
  estimatedCycleCapacityUsd: number
  reserveUsd: number
  allocatableCapacityUsd: number
  perShareCapacityUsd: number
}

function stableCapacityEstimate(source: Partial<StableCapacityEstimate> | undefined): StableCapacityEstimate | undefined {
  if (
    typeof source?.estimatedCycleCapacityUsd !== 'number'
    || typeof source.reserveUsd !== 'number'
    || typeof source.allocatableCapacityUsd !== 'number'
    || typeof source.perShareCapacityUsd !== 'number'
  ) return undefined
  return {
    estimatedCycleCapacityUsd: source.estimatedCycleCapacityUsd,
    reserveUsd: source.reserveUsd,
    allocatableCapacityUsd: source.allocatableCapacityUsd,
    perShareCapacityUsd: source.perShareCapacityUsd,
  }
}

export class AutomationEngine {
  private config: ServiceConfig
  private timers: Partial<Record<JobKind, NodeJS.Timeout>> = {}
  private running: Record<JobKind, boolean> = { reset: false, capacity: false }
  private userConcurrencyTimer: NodeJS.Timeout | undefined
  private userConcurrencyQueue: Promise<void> = Promise.resolve()

  constructor(
    config: ServiceConfig,
    private readonly client: Sub2ApiClient,
    private readonly store: StateStore,
  ) {
    this.config = config
  }

  getConfig(): ServiceConfig {
    return structuredClone(this.config)
  }

  async initialize(): Promise<void> {
    await this.store.ensureAccounts(this.config.accounts)
  }

  start(): void {
    this.stop()
    this.schedule('reset', 0)
    this.schedule('capacity', 1_500)
    if (this.config.userConcurrencySchedule.enabled) this.scheduleUserConcurrency(3_000)
  }

  stop(): void {
    for (const timer of Object.values(this.timers)) clearTimeout(timer)
    this.timers = {}
    if (this.userConcurrencyTimer) clearTimeout(this.userConcurrencyTimer)
    this.userConcurrencyTimer = undefined
  }

  async replaceConfig(config: ServiceConfig): Promise<void> {
    const restoreDefault = this.config.userConcurrencySchedule.enabled && !config.userConcurrencySchedule.enabled
    this.stop()
    this.config = structuredClone(config)
    await this.store.ensureAccounts(config.accounts)
    if (restoreDefault) await this.runUserConcurrency(new Date(), true)
    this.start()
  }

  async runUserConcurrency(at = new Date(), forceDefault = false): Promise<void> {
    const task = this.userConcurrencyQueue.then(() => this.reconcileUserConcurrency(at, forceDefault))
    this.userConcurrencyQueue = task.catch(() => undefined)
    return task
  }

  async run(kind: JobKind, manual = false): Promise<void> {
    if (this.running[kind]) throw new Error(`${kind === 'reset' ? '重置' : '容量'}任务正在执行`)
    this.running[kind] = true
    const startedAt = await this.store.startJob(kind, manual)
    let failures = 0
    let processed = 0
    try {
      for (const account of this.config.accounts.filter((item) => item.enabled)) {
        try {
          if (kind === 'reset') await this.syncReset(account)
          else await this.syncCapacity(account)
          processed += 1
        } catch (error) {
          failures += 1
          const message = errorMessage(error)
          await this.store.updateAccount(account.key, (state) => {
            state.lastError = message
            state.lastErrorAt = nowIso()
            state.lastErrorJob = kind
          })
          await this.store.addEvent({
            severity: 'error',
            category: kind,
            summary: `${account.label}：${message}`,
            accountKey: account.key,
          })
        }
      }
    } finally {
      this.running[kind] = false
      const message = failures > 0
        ? `完成 ${processed} 个账号，${failures} 个失败`
        : `已检查 ${processed} 个账号`
      await this.store.finishJob(kind, startedAt, failures, message)
    }
  }

  private schedule(kind: JobKind, delayMs: number): void {
    const intervalSeconds = kind === 'reset'
      ? this.config.resetSync.intervalSeconds
      : this.config.capacitySync.intervalSeconds
    const nextRunAt = new Date(Date.now() + delayMs).toISOString()
    void this.store.setNextRun(kind, nextRunAt)
    this.timers[kind] = setTimeout(() => {
      void this.run(kind).catch((error) => {
        console.error(`[${kind}]`, error)
      }).finally(() => this.schedule(kind, intervalSeconds * 1_000))
    }, delayMs)
  }

  private scheduleUserConcurrency(delayMs: number): void {
    if (!this.config.userConcurrencySchedule.enabled) return
    this.userConcurrencyTimer = setTimeout(() => {
      void this.runUserConcurrency().catch((error) => {
        console.error('[concurrency]', error)
      }).finally(() => {
        if (this.config.userConcurrencySchedule.enabled) {
          this.scheduleUserConcurrency(USER_CONCURRENCY_INTERVAL_MS)
        }
      })
    }, delayMs)
  }

  private async reconcileUserConcurrency(at: Date, forceDefault: boolean): Promise<void> {
    const schedule = structuredClone(this.config.userConcurrencySchedule)
    if (!schedule.enabled && !forceDefault) return

    const target = forceDefault
      ? { concurrency: schedule.idleConcurrency, rpmLimit: schedule.idleRpm, period: 'idle' as const }
      : concurrencyScheduleTarget(at, schedule)
    const exempt = new Set(schedule.exemptUserIds)
    try {
      const users = (await this.client.users()).filter((user) => user.status === 'active')
      const peakUserIds: number[] = []
      const defaultUserIds: number[] = []
      const exemptUserIds: number[] = []
      for (const user of users) {
        const isExempt = exempt.has(user.id)
        const usesPeakLimit = target.period === 'peak' && !isExempt
        const wantedConcurrency = usesPeakLimit ? schedule.peakConcurrency : schedule.idleConcurrency
        const wantedRpm = isExempt ? 0 : usesPeakLimit ? schedule.peakRpm : schedule.idleRpm
        if (user.concurrency === wantedConcurrency && user.rpm_limit === wantedRpm) continue
        if (isExempt) exemptUserIds.push(user.id)
        else if (usesPeakLimit) peakUserIds.push(user.id)
        else defaultUserIds.push(user.id)
      }
      if (peakUserIds.length === 0 && defaultUserIds.length === 0 && exemptUserIds.length === 0) return

      if (peakUserIds.length > 0) {
        await this.client.batchSetUserLimits(peakUserIds, {
          concurrency: schedule.peakConcurrency,
          rpmLimit: schedule.peakRpm,
        })
      }
      if (defaultUserIds.length > 0) {
        await this.client.batchSetUserLimits(defaultUserIds, {
          concurrency: schedule.idleConcurrency,
          rpmLimit: schedule.idleRpm,
        })
      }
      if (exemptUserIds.length > 0) {
        await this.client.batchSetUserLimits(exemptUserIds, {
          concurrency: schedule.idleConcurrency,
          rpmLimit: 0,
        })
      }
      await this.store.addEvent({
        severity: 'success',
        category: 'concurrency',
        summary: `用户峰谷限制已校准：高峰 ${schedule.peakConcurrency} 并发 / ${schedule.peakRpm} RPM 写入 ${peakUserIds.length} 人，闲时 ${schedule.idleConcurrency} 并发 / ${schedule.idleRpm} RPM 写入 ${defaultUserIds.length} 人，豁免 ${schedule.idleConcurrency} 并发 / RPM 不限写入 ${exemptUserIds.length} 人`,
        details: {
          period: target.period,
          peakUsers: peakUserIds.length,
          defaultUsers: defaultUserIds.length,
          exemptUsers: exemptUserIds.length,
          peakConcurrency: schedule.peakConcurrency,
          idleConcurrency: schedule.idleConcurrency,
          peakRpm: schedule.peakRpm,
          idleRpm: schedule.idleRpm,
          configuredExemptUsers: schedule.exemptUserIds.length,
          forcedDefault: forceDefault,
        },
      })
    } catch (error) {
      await this.store.addEvent({
        severity: 'error',
        category: 'concurrency',
        summary: `用户峰谷限制校准失败：${errorMessage(error)}`,
        details: { period: target.period, forcedDefault: forceDefault },
      })
      throw error
    }
  }

  private async resolveAccount(config: AccountConfig): Promise<number> {
    const state = this.store.snapshot().accounts[config.key]
    if (state?.accountId) return state.accountId
    const account = await this.client.resolveOpenAIAccount(config.email)
    await this.store.updateAccount(config.key, (draft) => {
      draft.accountId = account.id
      draft.resolvedAt = nowIso()
    })
    return account.id
  }

  private async observeQuota(accountId: number): Promise<QuotaObservation> {
    const quota = await this.client.openAIQuota(accountId)
    const window = quota.rate_limit?.primary_window
    if (!window || !Number.isFinite(window.used_percent) || !Number.isFinite(window.reset_at)) {
      throw new Error('上游未返回可用的周限窗口')
    }
    return {
      resetAt: window.reset_at,
      usedPercent: window.used_percent,
      fetchedAt: quota.fetched_at,
      observedAt: nowIso(),
    }
  }

  private async syncReset(config: AccountConfig): Promise<void> {
    const accountId = await this.resolveAccount(config)
    const currentState = this.store.snapshot().accounts[config.key]
    if (currentState?.reset.pendingEvent) {
      await this.completeReset(config, currentState.reset.pendingEvent)
    }

    const observation = await this.observeQuota(accountId)
    const resetState = this.store.snapshot().accounts[config.key]?.reset
    const previous = resetState?.observation
    if (!previous) {
      await this.store.updateAccount(config.key, (draft) => {
        draft.reset.observation = observation
        draft.reset.baselineCreatedAt = nowIso()
        this.clearError(draft, 'reset')
      })
      await this.store.addEvent({
        severity: 'info',
        category: 'reset',
        summary: `${config.label}：已建立周限基线，未执行重置`,
        accountKey: config.key,
        details: { resetAt: observation.resetAt, usedPercent: observation.usedPercent },
      })
      return
    }

    if (!isNewResetWindow(
      previous,
      observation,
      this.config.resetSync.resetAtToleranceSeconds,
      this.config.resetSync.usageDropTolerancePercent,
    )) {
      await this.store.updateAccount(config.key, (draft) => {
        draft.reset.observation = observation
        this.clearError(draft, 'reset')
      })
      return
    }

    if (resetState?.lastHandledResetAt && observation.resetAt <= resetState.lastHandledResetAt) {
      await this.store.updateAccount(config.key, (draft) => {
        draft.reset.observation = observation
      })
      return
    }

    await this.finalizeCycle(config.key, previous, config.shareCount)

    const subscriptions = await this.client.activeSubscriptions(config.targetGroupIds)
    const event: PendingResetEvent = {
      id: randomUUID(),
      detectedAt: nowIso(),
      previousObservation: previous,
      observation,
      targetSubscriptionIds: subscriptions.map((item) => item.id),
      completedSubscriptionIds: [],
    }
    await this.store.updateAccount(config.key, (draft) => {
      draft.reset.pendingEvent = event
    })
    await this.store.addEvent({
      severity: 'warning',
      category: 'reset',
      summary: `${config.label}：检测到新周期，准备重置 ${subscriptions.length} 个订阅`,
      accountKey: config.key,
      details: { previousResetAt: previous.resetAt, resetAt: observation.resetAt },
    })
    await this.completeReset(config, event)
  }

  private async completeReset(config: AccountConfig, event: PendingResetEvent): Promise<void> {
    const completed = new Set(event.completedSubscriptionIds)
    for (const subscriptionId of event.targetSubscriptionIds) {
      if (completed.has(subscriptionId)) continue
      await this.client.resetSubscriptionWeekly(subscriptionId)
      completed.add(subscriptionId)
      await this.store.updateAccount(config.key, (draft) => {
        if (draft.reset.pendingEvent?.id === event.id) {
          draft.reset.pendingEvent.completedSubscriptionIds = [...completed]
        }
      })
    }
    await this.store.updateAccount(config.key, (draft) => {
      draft.reset.observation = event.observation
      draft.reset.lastHandledResetAt = event.observation.resetAt
      draft.reset.lastCompletedEventAt = nowIso()
      draft.reset.pendingEvent = null
      this.clearError(draft, 'reset')
    })
    await this.store.addEvent({
      severity: 'success',
      category: 'reset',
      summary: `${config.label}：已重置 ${event.targetSubscriptionIds.length} 个订阅的周用量`,
      accountKey: config.key,
      details: { eventId: event.id, subscriptionIds: event.targetSubscriptionIds },
    })
  }

  private async recordCycleObservation(
    config: AccountConfig,
    observation: QuotaObservation,
    usageUsd: number,
    resetAtToleranceSeconds: number,
    estimate?: { cycleCapacityUsd: number; reserveUsd: number; allocatableCapacityUsd: number; perShareCapacityUsd: number },
  ): Promise<void> {
    await this.store.updateAccount(config.key, (draft) => {
      const existing = draft.reset.cycles ?? []
      const previous = existing.find((cycle) => isSameResetWindow(cycle.resetAt, observation.resetAt, resetAtToleranceSeconds))
      const cycleResetAt = previous?.resetAt ?? observation.resetAt
      const cycle: ResetCycleSummary = {
        ...(previous ?? {}),
        resetAt: cycleResetAt,
        startAt: previous?.startAt ?? cycleResetAt - SEVEN_DAYS_SECONDS,
        status: 'current',
        observedAt: observation.observedAt,
        usedPercent: observation.usedPercent,
        usageUsd,
        perShareUsageUsd: Math.round((usageUsd / config.shareCount + Number.EPSILON) * 100) / 100,
        ...(estimate ? {
          estimatedCycleCapacityUsd: estimate.cycleCapacityUsd,
          reserveUsd: estimate.reserveUsd,
          allocatableCapacityUsd: estimate.allocatableCapacityUsd,
          perShareCapacityUsd: estimate.perShareCapacityUsd,
        } : {}),
      }
      draft.reset.cycles = [
        cycle,
        ...existing
          .filter((item) => item.resetAt !== cycleResetAt)
          .map((item) => item.status === 'current' ? { ...item, status: 'completed' as const } : item),
      ].sort((left, right) => right.resetAt - left.resetAt).slice(0, MAX_CYCLE_HISTORY)
    })
  }

  private async finalizeCycle(accountKey: string, observation: QuotaObservation, shareCount: number): Promise<void> {
    await this.store.updateAccount(accountKey, (draft) => {
      const existing = draft.reset.cycles ?? []
      const toleranceSeconds = this.config.resetSync.resetAtToleranceSeconds
      const current = existing.find((cycle) => isSameResetWindow(cycle.resetAt, observation.resetAt, toleranceSeconds))
      const capacity = draft.capacity && isSameResetWindow(draft.capacity.resetAt, observation.resetAt, toleranceSeconds)
        ? draft.capacity
        : undefined
      const cycleResetAt = current?.resetAt ?? capacity?.resetAt ?? observation.resetAt
      const usageUsd = current?.usageUsd ?? capacity?.localStandardCostUsd
      const estimatedCycleCapacityUsd = current?.estimatedCycleCapacityUsd ?? capacity?.estimatedCycleCapacityUsd
      const reserveUsd = current?.reserveUsd ?? capacity?.reserveUsd
      const allocatableCapacityUsd = current?.allocatableCapacityUsd ?? capacity?.allocatableCapacityUsd
      const perShareCapacityUsd = current?.perShareCapacityUsd ?? capacity?.perShareCapacityUsd
      const cycle: ResetCycleSummary = {
        ...(current ?? {}),
        resetAt: cycleResetAt,
        startAt: current?.startAt ?? cycleResetAt - SEVEN_DAYS_SECONDS,
        status: 'completed',
        observedAt: current?.observedAt ?? observation.observedAt,
        usedPercent: current?.usedPercent ?? observation.usedPercent,
        ...(usageUsd === undefined ? {} : {
          usageUsd,
          perShareUsageUsd: current?.perShareUsageUsd
            ?? Math.round((usageUsd / shareCount + Number.EPSILON) * 100) / 100,
        }),
        ...(estimatedCycleCapacityUsd === undefined ? {} : { estimatedCycleCapacityUsd }),
        ...(reserveUsd === undefined ? {} : { reserveUsd }),
        ...(allocatableCapacityUsd === undefined ? {} : { allocatableCapacityUsd }),
        ...(perShareCapacityUsd === undefined ? {} : { perShareCapacityUsd }),
      }
      draft.reset.cycles = [
        cycle,
        ...existing.filter((item) => !isSameResetWindow(item.resetAt, observation.resetAt, toleranceSeconds)),
      ].sort((left, right) => right.resetAt - left.resetAt).slice(0, MAX_CYCLE_HISTORY)
    })
  }

  private async syncCapacity(config: AccountConfig): Promise<void> {
    const accountId = await this.resolveAccount(config)
    const [observation, usage, subscriptions] = await Promise.all([
      this.observeQuota(accountId),
      this.client.accountUsage(accountId),
      this.client.activeSubscriptions(config.targetGroupIds),
    ])
    const standardCostUsd = usage.seven_day?.window_stats?.standard_cost
    if (typeof standardCostUsd !== 'number' || !Number.isFinite(standardCostUsd)) {
      throw new Error('本周 standard_cost 尚不可用')
    }

    const accountState = this.store.snapshot().accounts[config.key]
    const previousCapacity = accountState?.capacity
    const toleranceSeconds = this.config.resetSync.resetAtToleranceSeconds
    const sameCapacityWindow = previousCapacity !== undefined
      && isSameResetWindow(previousCapacity.resetAt, observation.resetAt, toleranceSeconds)
    const matchingCycle = accountState?.reset.cycles?.find((cycle) => (
      isSameResetWindow(cycle.resetAt, observation.resetAt, toleranceSeconds)
    ))
    const canonicalResetAt = matchingCycle?.resetAt
      ?? (sameCapacityWindow ? previousCapacity.resetAt : observation.resetAt)
    const previousSamples = sameCapacityWindow
      ? previousCapacity.estimationSamples ?? []
      : []
    const estimationSamples = appendDistinctCapacitySample(
      previousSamples,
      standardCostUsd,
      observation.usedPercent,
      observation.observedAt,
    )
    const currentBucket = Math.floor(observation.usedPercent)
    const samePercentBucket = sameCapacityWindow
      && Math.floor(previousCapacity.usedPercent) === currentBucket
    const percentBucketAdvanced = !sameCapacityWindow
      || currentBucket > Math.floor(previousCapacity.usedPercent)
    const eligibleSamples = estimationSamples
      .filter((sample) => sample.usedPercent >= this.config.capacitySync.minimumUsedPercent)
      .slice(-CAPACITY_ESTIMATE_WINDOW)
    const previousEstimate = stableCapacityEstimate(sameCapacityWindow ? previousCapacity : undefined)
      ?? stableCapacityEstimate(matchingCycle)
    const configuredReserveUsd = previousEstimate === undefined
      ? undefined
      : resolveReserveUsd(previousEstimate.estimatedCycleCapacityUsd, {
        mode: config.reserveMode,
        value: config.reserveValue,
      })
    const allocationInputsChanged = sameCapacityWindow
      && previousEstimate !== undefined
      && (previousEstimate.reserveUsd !== configuredReserveUsd || previousCapacity.shareCount !== config.shareCount)
    const shouldEstimate = eligibleSamples.length > 0
      && (percentBucketAdvanced || previousEstimate === undefined || allocationInputsChanged)
    const estimate = shouldEstimate
      ? estimateCapacityFromSamples(
        eligibleSamples,
        config.shareCount,
        { mode: config.reserveMode, value: config.reserveValue },
      )
      : undefined
    await this.recordCycleObservation(
      config,
      observation,
      standardCostUsd,
      this.config.resetSync.resetAtToleranceSeconds,
      estimate,
    )

    if (!estimate) {
      const belowMinimum = observation.usedPercent < this.config.capacitySync.minimumUsedPercent
      const message = belowMinimum
        ? `使用率低于 ${this.config.capacitySync.minimumUsedPercent}%，仅采样，未更新分组`
        : samePercentBucket
          ? `使用率仍在 ${currentBucket}% 桶内，沿用上一估值`
          : !percentBucketAdvanced
            ? `使用率桶未前进，仅采样，未更新分组`
            : '当前样本尚不可用，未更新分组'
      const capacity: CapacityRuntime = {
        observedAt: observation.observedAt,
        resetAt: canonicalResetAt,
        usedPercent: observation.usedPercent,
        localStandardCostUsd: standardCostUsd,
        shareCount: config.shareCount,
        activeSubscriptions: subscriptions.length,
        status: previousEstimate?.estimatedCycleCapacityUsd === undefined ? 'insufficient-sample' : 'unchanged',
        message,
        groups: sameCapacityWindow ? previousCapacity.groups : [],
        estimationSamples,
        ...(previousEstimate?.estimatedCycleCapacityUsd === undefined ? {} : {
          estimatedCycleCapacityUsd: previousEstimate.estimatedCycleCapacityUsd,
          reserveUsd: previousEstimate.reserveUsd,
          allocatableCapacityUsd: previousEstimate.allocatableCapacityUsd,
          perShareCapacityUsd: previousEstimate.perShareCapacityUsd,
        }),
      }
      await this.saveCapacity(config, capacity)
      return
    }

    const groups = await Promise.all(config.targetGroupIds.map((groupId) => this.client.group(groupId)))
    const allocations = []
    let failed = false
    let updated = 0
    for (const group of groups) {
      const current = group.weekly_limit_usd
      const shouldUpdate = current === null
        || Math.abs(current - estimate.perShareCapacityUsd) >= this.config.capacitySync.minimumChangeUsd
      if (!shouldUpdate) {
        allocations.push(this.allocation(group, estimate.perShareCapacityUsd, false, 'unchanged'))
        continue
      }
      try {
        await this.client.updateGroupWeeklyLimit(group, estimate.perShareCapacityUsd)
        allocations.push(this.allocation(group, estimate.perShareCapacityUsd, true, 'updated'))
        updated += 1
      } catch (error) {
        failed = true
        allocations.push({
          ...this.allocation(group, estimate.perShareCapacityUsd, false, 'failed'),
          error: errorMessage(error),
        })
      }
    }

    const capacity: CapacityRuntime = {
      observedAt: observation.observedAt,
      resetAt: canonicalResetAt,
      usedPercent: observation.usedPercent,
      localStandardCostUsd: standardCostUsd,
      estimatedCycleCapacityUsd: estimate.cycleCapacityUsd,
      reserveUsd: estimate.reserveUsd,
      allocatableCapacityUsd: estimate.allocatableCapacityUsd,
      perShareCapacityUsd: estimate.perShareCapacityUsd,
      shareCount: config.shareCount,
      activeSubscriptions: subscriptions.length,
      status: failed ? 'failed' : updated > 0 ? 'updated' : 'unchanged',
      message: failed
        ? '部分分组更新失败'
        : updated > 0 ? `已更新 ${updated} 个分组` : '分组周限已是最新值',
      groups: allocations,
      estimationSamples,
    }
    await this.saveCapacity(config, capacity)
    if (failed) throw new Error('部分目标分组周限更新失败')
    if (updated > 0) {
      const reserveDescription = config.reserveMode === 'percent'
        ? `${config.reserveValue}%（$${estimate.reserveUsd.toFixed(2)}）`
        : `$${estimate.reserveUsd.toFixed(2)}`
      await this.store.addEvent({
        severity: 'success',
        category: 'capacity',
        summary: `${config.label}：预留 ${reserveDescription} 后，每份周限已更新为 $${estimate.perShareCapacityUsd.toFixed(2)}`,
        accountKey: config.key,
        details: {
          usedPercent: observation.usedPercent,
          standardCostUsd,
          estimatedCycleCapacityUsd: estimate.cycleCapacityUsd,
          reserveMode: config.reserveMode,
          reserveValue: config.reserveValue,
          reserveUsd: estimate.reserveUsd,
          allocatableCapacityUsd: estimate.allocatableCapacityUsd,
          shareCount: config.shareCount,
          targetGroupIds: config.targetGroupIds,
          sampleCount: eligibleSamples.length,
          sampleUsedPercents: eligibleSamples.map((sample: CapacityEstimateSample) => sample.usedPercent),
        },
      })
    }
  }

  private allocation(
    group: AdminGroup,
    targetLimitUsd: number,
    updated: boolean,
    status: 'updated' | 'unchanged' | 'failed',
  ) {
    return {
      groupId: group.id,
      name: group.name,
      currentLimitUsd: group.weekly_limit_usd,
      targetLimitUsd,
      rateMultiplier: group.rate_multiplier,
      updated,
      status,
    } as const
  }

  private async saveCapacity(config: AccountConfig, capacity: CapacityRuntime): Promise<void> {
    await this.store.updateAccount(config.key, (draft) => {
      draft.capacity = capacity
      this.clearError(draft, 'capacity')
    })
  }

  private clearError(account: import('../../shared/contracts.js').AccountRuntime, kind: JobKind): void {
    if (account.lastErrorJob !== kind) return
    delete account.lastError
    delete account.lastErrorAt
    delete account.lastErrorJob
  }
}
