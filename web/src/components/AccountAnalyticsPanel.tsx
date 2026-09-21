import { SelectionRail, SelectionIndicator } from './SelectionRail'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Clock3, Gauge, Layers3, RefreshCw, UsersRound } from 'lucide-react'
import { useState } from 'react'

import type {
  AccountAnalyticsResponse,
  AccountRuntime,
  AccountUserAnalytics,
  AnalyticsRange,
  ResetCycleSummary,
  RequestTypeBreakdown,
} from '@shared/contracts'
import { api } from '@/lib/api'
import { currency, dateTime, percent } from '@/lib/format'

type FixedAnalyticsRange = Exclude<AnalyticsRange, 'cycle'>
type AnalyticsSelection =
  | { range: FixedAnalyticsRange }
  | { range: 'cycle'; cycleResetAt: number }

const RANGE_OPTIONS: Array<{ value: FixedAnalyticsRange; label: string }> = [
  { value: 'day', label: '24 小时' },
  { value: 'week', label: '7 天' },
  { value: 'month', label: '30 天' },
]

const RESET_AT_MATCH_TOLERANCE_SECONDS = 3_600
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60

function cycleOptions(account: AccountRuntime): ResetCycleSummary[] {
  const saved = [...(account.reset.cycles ?? [])].sort((left, right) => right.resetAt - left.resetAt)
  const currentResetAt = account.reset.pendingEvent?.observation.resetAt
    ?? account.reset.observation?.resetAt
    ?? account.capacity?.resetAt
  if (currentResetAt === undefined) return saved
  const current = saved.find((cycle) => Math.abs(cycle.resetAt - currentResetAt) <= RESET_AT_MATCH_TOLERANCE_SECONDS)
    ?? {
      resetAt: currentResetAt,
      startAt: currentResetAt - SEVEN_DAYS_SECONDS,
      status: 'current' as const,
      observedAt: '',
    }
  const options = [current, ...saved.filter((cycle) => Math.abs(cycle.resetAt - current.resetAt) > RESET_AT_MATCH_TOLERANCE_SECONDS)]
  for (let index = 1; index <= 3; index += 1) {
    const resetAt = current.resetAt - index * SEVEN_DAYS_SECONDS
    if (options.some((cycle) => Math.abs(cycle.resetAt - resetAt) <= RESET_AT_MATCH_TOLERANCE_SECONDS)) continue
    options.push({ resetAt, startAt: resetAt - SEVEN_DAYS_SECONDS, status: 'completed', observedAt: '' })
  }
  return options
}

function cycleLabel(cycle: ResetCycleSummary, index: number): string {
  if (index === 0 && cycle.status === 'current') return '当前重置周期'
  if (index === 1) return '上一个重置周期'
  return `上 ${index} 个重置周期`
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

function exactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

function duration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value < 1_000) return `${Math.round(value)} ms`
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value / 1_000)} s`
}

function tps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)
}

function RequestMix({ types }: { types: RequestTypeBreakdown }) {
  const visible = [
    { key: 'websocket', label: 'WS', value: types.websocket },
    { key: 'stream', label: '流式', value: types.stream },
    { key: 'sync', label: '同步', value: types.sync },
    { key: 'live', label: 'Live', value: types.live },
    { key: 'other', label: '其他', value: types.other },
  ].filter((item) => item.value > 0)

  if (visible.length === 0) return <span className="analytics-na">—</span>
  return (
    <span className="request-mix">
      {visible.map((item) => <span key={item.key}>{item.label} <b>{compactNumber(item.value)}</b></span>)}
    </span>
  )
}

function UserAnalytics({ user, initiallyOpen }: { user: AccountUserAnalytics; initiallyOpen: boolean }) {
  return (
    <details className="user-analytics" open={initiallyOpen}>
      <summary>
        <span className="user-analytics__identity">
          <span className="user-avatar" aria-hidden="true">{(user.username || user.email).slice(0, 1).toUpperCase()}</span>
          <span><strong>{user.email}</strong><small>{user.username || '未设置用户名'} · 用户 #{user.userId}</small></span>
        </span>
        <span className="user-analytics__metric"><small>请求</small><strong>{exactNumber(user.requests)}</strong></span>
        <span className="user-analytics__metric"><small>Token</small><strong title={exactNumber(user.totalTokens)}>{compactNumber(user.totalTokens)}</strong></span>
        <span className="user-analytics__metric"><small>实际计费</small><strong>{currency(user.costUsd)}</strong></span>
        <span className="user-analytics__metric"><small>缓存命中</small><strong>{percent(user.cacheHitRate)}</strong></span>
        <ChevronDown className="user-analytics__chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="model-analytics-wrap" data-no-swipe>
        {user.models.length > 0 ? <table className="model-analytics-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>请求 / Token</th>
              <th>实际计费</th>
              <th>缓存命中</th>
              <th>平均 TPS</th>
              <th>首字 / 响应</th>
              <th>请求类型</th>
            </tr>
          </thead>
          <tbody>
            {user.models.map((model) => (
              <tr key={model.model}>
                <td data-label="模型"><strong>{model.model}</strong></td>
                <td data-label="请求 / Token">
                  <strong>{exactNumber(model.requests)} <i>/</i> <span title={exactNumber(model.totalTokens)}>{compactNumber(model.totalTokens)}</span></strong>
                  <small>输入 {compactNumber(model.inputTokens + model.cacheReadTokens)} · 输出 {compactNumber(model.outputTokens)}</small>
                </td>
                <td data-label="实际计费"><strong>{currency(model.costUsd)}</strong><small>{model.costUsd > 0 ? `${currency(model.costUsd / model.requests)} / 请求` : '—'}</small></td>
                <td data-label="缓存命中"><strong>{percent(model.cacheHitRate)}</strong><small>命中 {compactNumber(model.cacheReadTokens)} token</small></td>
                <td data-label="平均 TPS"><strong>{tps(model.averageTps)}</strong><small>token / s</small></td>
                <td data-label="首字 / 响应"><strong>{duration(model.averageFirstTokenMs)} <i>/</i> {duration(model.averageDurationMs)}</strong><small>TTFT · 端到端</small></td>
                <td data-label="请求类型"><RequestMix types={model.requestTypes} /></td>
              </tr>
            ))}
          </tbody>
        </table> : <p className="model-analytics-empty">该用户在当前时间范围内没有请求</p>}
      </div>
    </details>
  )
}

function AnalyticsContent({ data }: { data: AccountAnalyticsResponse }) {
  if (data.users.length === 0) {
    return (
      <div className="account-analytics__empty">
        <Layers3 size={19} aria-hidden="true" />
        <div><strong>这个时间段没有用量</strong><p>当账号产生新请求后，用户和模型数据会出现在这里。</p></div>
      </div>
    )
  }

  return (
    <>
      <dl className="account-analytics__summary">
        <div><dt><UsersRound size={13} aria-hidden="true" />关联 / 有用量</dt><dd>{data.users.length} <small>/ {data.usersWithUsage}</small></dd></div>
        <div><dt><Layers3 size={13} aria-hidden="true" />请求</dt><dd>{exactNumber(data.requests)}</dd></div>
        <div><dt>Token</dt><dd title={exactNumber(data.totalTokens)}>{compactNumber(data.totalTokens)}</dd></div>
        <div><dt>实际计费</dt><dd>{currency(data.costUsd)}</dd></div>
        <div><dt><Gauge size={13} aria-hidden="true" />缓存命中</dt><dd>{percent(data.cacheHitRate)}</dd></div>
        <div><dt><Clock3 size={13} aria-hidden="true" />平均响应</dt><dd>{duration(data.averageDurationMs)}</dd></div>
      </dl>
      <div className="account-analytics__users">
        {data.users.map((user, index) => <UserAnalytics key={user.userId} user={user} initiallyOpen={index === 0} />)}
      </div>
      <p className="analytics-methodology">
        展示目标分组内全部活跃订阅用户，无请求的用户保留为 0；缓存命中率 = 缓存读取 Token / 总输入 Token；TPS 按首字返回后的生成耗时加权；首字时间仅统计 sub2api 已记录 TTFT 的请求；金额为 actual cost。
      </p>
    </>
  )
}

export function AccountAnalyticsPanel({ account }: { account: AccountRuntime }) {
  const cycles = cycleOptions(account)
  const [selection, setSelection] = useState<AnalyticsSelection>(() => cycles[0]
    ? { range: 'cycle', cycleResetAt: cycles[0].resetAt }
    : { range: 'week' })
  const currentCycleResetAt = cycles[0]?.resetAt
  const selectedHistoricalCycle = selection.range === 'cycle'
    && selection.cycleResetAt !== currentCycleResetAt
    ? selection.cycleResetAt
    : ''
  const query = useQuery({
    queryKey: ['account-analytics', account.key, selection.range, selection.range === 'cycle' ? selection.cycleResetAt : null],
    queryFn: () => api.accountAnalytics(account.key, selection.range, selection.range === 'cycle' ? selection.cycleResetAt : undefined),
    staleTime: 60_000,
  })

  return (
    <section className="account-analytics" aria-label="用户与模型用量">
      <header className="account-analytics__header">
        <div><h3>用户与模型用量</h3><p>{query.data ? `${selection.range === 'cycle' ? '重置周期 · ' : ''}${dateTime(query.data.startAt)} 至 ${dateTime(query.data.endAt)}` : '按账号的实际上游请求聚合'}</p></div>
        <div className="account-analytics__controls">
        <SelectionRail className="range-switch account-analytics__range-switch" role="group" aria-label="用量时间范围">
          {RANGE_OPTIONS.map((option) => (
            <button key={option.value} type="button" aria-pressed={selection.range === option.value} onClick={() => setSelection({ range: option.value })}><SelectionIndicator active={selection.range === option.value} />{option.label}</button>
          ))}
          {currentCycleResetAt !== undefined && <button type="button" aria-pressed={selection.range === 'cycle' && selection.cycleResetAt === currentCycleResetAt} onClick={() => setSelection({ range: 'cycle', cycleResetAt: currentCycleResetAt })}><SelectionIndicator active={selection.range === 'cycle' && selection.cycleResetAt === currentCycleResetAt} />本周期</button>}
        </SelectionRail>
        {cycles.length > 1 && <label className="account-analytics__cycle-select"><span>历史周期</span><select aria-label="选择历史重置周期" value={selectedHistoricalCycle} onChange={(event) => {
          const resetAt = Number(event.target.value)
          if (Number.isFinite(resetAt) && resetAt > 0) setSelection({ range: 'cycle', cycleResetAt: resetAt })
        }}>
          <option value="">选择周期</option>
          {cycles.slice(1).map((cycle, index) => <option key={cycle.resetAt} value={cycle.resetAt}>{cycleLabel(cycle, index + 1)} · {dateTime(cycle.resetAt)}</option>)}
        </select></label>}
        </div>
      </header>

      {query.isPending && (
        <div className="account-analytics__loading" role="status" aria-live="polite">
          <span className="analytics-skeleton analytics-skeleton--wide" />
          <span className="analytics-skeleton" />
          <span className="analytics-skeleton analytics-skeleton--short" />
          <span className="sr-only">正在读取账号用量</span>
        </div>
      )}
      {query.error && (
        <div className="account-analytics__error" role="alert">
          <div><strong>用量读取失败</strong><p>{query.error.message}</p></div>
          <button type="button" onClick={() => void query.refetch()}><RefreshCw size={14} aria-hidden="true" />重试</button>
        </div>
      )}
      {query.data && <AnalyticsContent data={query.data} />}
    </section>
  )
}
