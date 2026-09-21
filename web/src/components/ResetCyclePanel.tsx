import { CalendarDays, CircleHelp, History, TrendingDown, TrendingUp } from 'lucide-react'

import type { AccountRuntime, ResetCycleSummary } from '@shared/contracts'
import { currency, dateTime, percent } from '@/lib/format'

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60
const RESET_AT_MATCH_TOLERANCE_SECONDS = 3_600
const DISPLAY_CYCLES = 4

function cycleRows(account: AccountRuntime): ResetCycleSummary[] {
  const saved = [...(account.reset.cycles ?? [])].sort((left, right) => right.resetAt - left.resetAt)
  const resetAt = account.reset.pendingEvent?.observation.resetAt ?? account.reset.observation?.resetAt ?? account.capacity?.resetAt ?? saved[0]?.resetAt
  if (!resetAt) return saved.slice(0, DISPLAY_CYCLES)

  const baseCurrent = saved.find((cycle) => Math.abs(cycle.resetAt - resetAt) <= RESET_AT_MATCH_TOLERANCE_SECONDS)
    ?? {
      resetAt,
      startAt: resetAt - SEVEN_DAYS_SECONDS,
      status: 'current' as const,
      observedAt: '',
    }
  const currentCapacity = account.capacity && Math.abs(account.capacity.resetAt - resetAt) <= RESET_AT_MATCH_TOLERANCE_SECONDS ? account.capacity : undefined
  const current: ResetCycleSummary = {
    ...baseCurrent,
    ...(currentCapacity ? {
      usedPercent: currentCapacity.usedPercent,
      usageUsd: currentCapacity.localStandardCostUsd,
      ...(currentCapacity.estimatedCycleCapacityUsd === undefined ? {} : { estimatedCycleCapacityUsd: currentCapacity.estimatedCycleCapacityUsd }),
      ...(currentCapacity.reserveUsd === undefined ? {} : { reserveUsd: currentCapacity.reserveUsd }),
      ...(currentCapacity.allocatableCapacityUsd === undefined ? {} : { allocatableCapacityUsd: currentCapacity.allocatableCapacityUsd }),
      ...(currentCapacity.perShareCapacityUsd === undefined ? {} : { perShareCapacityUsd: currentCapacity.perShareCapacityUsd }),
      perShareUsageUsd: Math.round((currentCapacity.localStandardCostUsd / currentCapacity.shareCount + Number.EPSILON) * 100) / 100,
    } : {}),
  }
  const rows = [current, ...saved.filter((cycle) => cycle.resetAt !== current.resetAt)]
  while (rows.length < DISPLAY_CYCLES) {
    const previous = rows.at(-1)!
    rows.push({
      resetAt: previous.resetAt - SEVEN_DAYS_SECONDS,
      startAt: previous.startAt - SEVEN_DAYS_SECONDS,
      status: 'completed',
      observedAt: '',
    })
  }
  return rows.slice(0, DISPLAY_CYCLES)
}

function cycleDay(cycle: ResetCycleSummary): string {
  if (cycle.status === 'completed') return '已结束'
  const now = Math.floor(Date.now() / 1_000)
  const elapsed = Math.max(0, Math.min(SEVEN_DAYS_SECONDS, now - cycle.startAt))
  return `第 ${Math.max(1, Math.ceil(elapsed / (24 * 60 * 60)))} / 7 天`
}

function usageLabel(cycle: ResetCycleSummary): string {
  return cycle.usageUsd === undefined ? '未统计' : currency(cycle.usageUsd)
}

function usageDelta(current: ResetCycleSummary, previous: ResetCycleSummary | undefined): { label: string; positive: boolean } | null {
  if (current.usageUsd === undefined || previous?.usageUsd === undefined) return null
  const delta = current.usageUsd - previous.usageUsd
  return {
    label: `${delta >= 0 ? '+' : ''}${currency(delta)}`,
    positive: delta <= 0,
  }
}

export function ResetCyclePanel({ account }: { account: AccountRuntime }) {
  const cycles = cycleRows(account)
  if (cycles.length === 0) return null
  const current = cycles[0]!
  const delta = usageDelta(current, cycles[1])
  const hasObservedUsage = cycles.some((cycle) => cycle.usageUsd !== undefined)

  return (
    <section className="reset-cycle-panel" aria-label="重置周期统计">
      <header className="reset-cycle-panel__header">
        <h3><History size={16} aria-hidden="true" />重置周期统计</h3>
        <span className="reset-cycle-panel__source"><CalendarDays size={14} aria-hidden="true" />{current.status === 'current' ? cycleDay(current) : '等待新周期'}</span>
      </header>

      <div className="reset-cycle-current">
        <div className="reset-cycle-current__main">
          <span>当前周期使用</span>
          <strong>{usageLabel(current)}</strong>
          <small>{current.usedPercent === undefined ? '使用率未统计' : `周限已用 ${percent(current.usedPercent)}`} · 预计重置 {dateTime(current.resetAt)}</small>
        </div>
        <div><span>周期容量估算</span><strong>{current.estimatedCycleCapacityUsd === undefined ? '未统计' : currency(current.estimatedCycleCapacityUsd)}</strong><small>{current.allocatableCapacityUsd === undefined ? '可分配金额未统计' : `可分配 ${currency(current.allocatableCapacityUsd)} · 预留 ${currency(current.reserveUsd)}`}</small></div>
        <div><span>每份实际使用</span><strong>{current.perShareUsageUsd === undefined ? '未统计' : currency(current.perShareUsageUsd)}</strong></div>
        <div><span>较上周期</span><strong className={delta ? (delta.positive ? 'is-positive' : 'is-negative') : ''}>{delta?.label ?? '未统计'}</strong></div>
      </div>

      <div className="reset-cycle-list" aria-label="最近重置周期">
        {cycles.map((cycle, index) => {
          const itemDelta = usageDelta(cycle, cycles[index + 1])
          const isCurrent = index === 0 && cycle.status === 'current'
          return (
            <article className={`reset-cycle-card${isCurrent ? ' reset-cycle-card--current' : ''}${cycle.usageUsd === undefined ? ' reset-cycle-card--untracked' : ''}`} key={`${cycle.resetAt}-${index}`}>
              <header><span>{isCurrent ? '当前周期' : index === 1 ? '上一个周期' : `上 ${index} 个周期`}</span><b>{cycleDay(cycle)}</b></header>
              <strong>{usageLabel(cycle)}</strong>
              <small>{cycle.usedPercent === undefined ? '周限使用未统计' : `周限 ${percent(cycle.usedPercent)}`} · 重置 {dateTime(cycle.resetAt)}</small>
              {itemDelta ? <em className={itemDelta.positive ? 'is-positive' : 'is-negative'}>{itemDelta.positive ? <TrendingDown size={12} aria-hidden="true" /> : <TrendingUp size={12} aria-hidden="true" />}{itemDelta.label} 对比再前一周期</em> : <em><CircleHelp size={12} aria-hidden="true" />{cycle.observedAt ? '暂无可比较周期' : '历史数据未采集'}</em>}
            </article>
          )
        })}
      </div>
      {!hasObservedUsage && <p className="reset-cycle-panel__empty"><CircleHelp size={14} aria-hidden="true" />尚未采集到可用于周期金额统计的 standard cost，后续同步后会自动补齐。</p>}
    </section>
  )
}
