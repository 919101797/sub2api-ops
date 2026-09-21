import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  ArrowRight,
  RefreshCw,
  Layers3,
  UsersRound,
  Gauge,
  CheckCheck,
  Clock3,
  Activity,
  Play,
  CircleDot,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DashboardResponse, JobRuntime } from '@shared/contracts'
import { AccountLink } from '@/components/AccountLink'
import { Button, PageHeading, StatusPill } from '@/components/ui'
import { api } from '@/lib/api'
import { currency, dateTime, percent, relativeTime } from '@/lib/format'

function jobTone(job: JobRuntime) {
  return job.running
    ? 'warning'
    : job.health === 'degraded'
      ? 'danger'
      : job.health === 'healthy'
        ? 'healthy'
        : 'neutral'
}
function jobLabel(job: JobRuntime) {
  return job.running
    ? '执行中'
    : job.health === 'degraded'
      ? '需要关注'
      : job.health === 'healthy'
        ? '运行正常'
        : '等待运行'
}
function usageTone(value: number | undefined) {
  return value === undefined ? 'neutral' : value >= 85 ? 'danger' : value >= 70 ? 'warning' : 'healthy'
}
export function OverviewPage({ dashboard }: { dashboard: DashboardResponse }) {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError('')
    try {
      await queryClient.fetchQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, staleTime: 0 })
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : '刷新失败，请重试')
    } finally {
      setRefreshing(false)
    }
  }
  const run = useMutation({
    mutationFn: api.run,
    onMutate: () => setNotice(''),
    onSuccess: (result, kind) => {
      setNotice(
        result.accepted
          ? `${kind === 'reset' ? '周期重置' : '容量同步'}任务已接受，可在活动中查看执行结果。`
          : '任务正在运行，请稍后查看结果。',
      )
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
  const accounts = dashboard.accounts
  const capacitySamples = accounts.filter((account) => account.capacity?.estimatedCycleCapacityUsd !== undefined)
  const allocationSamples = accounts.filter((account) => account.capacity?.allocatableCapacityUsd !== undefined)
  const totalCapacity = capacitySamples.length
    ? capacitySamples.reduce((sum, account) => sum + account.capacity!.estimatedCycleCapacityUsd!, 0)
    : undefined
  const totalAllocation = allocationSamples.length
    ? allocationSamples.reduce((sum, account) => sum + account.capacity!.allocatableCapacityUsd!, 0)
    : undefined
  const usageSamples = accounts.flatMap((account) =>
    account.capacity?.usedPercent === undefined ? [] : [account.capacity.usedPercent],
  )
  const maxUsage = usageSamples.length ? Math.max(...usageSamples) : undefined
  const healthyJobs = dashboard.jobs.filter((job) => job.health === 'healthy').length
  const latest = dashboard.events[0]
  const coverage = (count: number) => `${count} / ${accounts.length} 个账号已统计`
  return (
    <>
      <div className="overview-intro">
        <PageHeading
          title="运维总览"
          actions={
            <>
              <span className="sync-stamp">数据生成于 {dateTime(dashboard.generatedAt)}</span>
              <Button variant="secondary" busy={refreshing} onClick={() => void refresh()}>
                <RefreshCw size={14} aria-hidden="true" />
                刷新数据
              </Button>
            </>
          }
        />
        {refreshError && (
          <p className="form-error" role="alert">
            {refreshError}
          </p>
        )}
        <section className="overview-status" aria-label="服务健康状态">
          <div>
            <StatusPill tone={dashboard.service.health === 'healthy' ? 'healthy' : 'danger'}>
              {dashboard.service.health === 'healthy' ? '自动化正常' : '自动化降级'}
            </StatusPill>
            <span>{latest?.summary ?? '等待首次自动化记录'}</span>
          </div>
          <Link to="/activity" aria-label="查看自动化活动">
            <ArrowUpRight size={17} />
          </Link>
        </section>
        <section className="metric-grid" aria-label="资源指标">
          <article className="metric-card">
            <div className="metric-label">
              <span>受管账号</span>
              <UsersRound size={17} />
            </div>
            <strong className="metric-value">
              {accounts.length.toString().padStart(2, '0')}
              <small>个</small>
            </strong>
            <footer>
              <span className="metric-dot" />
              {dashboard.infrastructure.filter((item) => item.proxy?.status === 'active').length} 个家宽出口在线
            </footer>
          </article>
          <article className="metric-card">
            <div className="metric-label">
              <span>周期估算容量</span>
              <Layers3 size={17} />
            </div>
            <strong className="metric-value metric-value--money">{currency(totalCapacity)}</strong>
            <footer>{coverage(capacitySamples.length)}</footer>
          </article>
          <article className="metric-card">
            <div className="metric-label">
              <span>可分配容量</span>
              <Gauge size={17} />
            </div>
            <strong className="metric-value metric-value--money">{currency(totalAllocation)}</strong>
            <footer>已扣除预留 · {coverage(allocationSamples.length)}</footer>
          </article>
          <article className="metric-card metric-card--accent">
            <div className="metric-label">
              <span>自动化任务</span>
              <CheckCheck size={18} />
            </div>
            <strong className="metric-value">
              {healthyJobs.toString().padStart(2, '0')}
              <small>/ {dashboard.jobs.length.toString().padStart(2, '0')}</small>
            </strong>
            <footer>
              <span className="metric-dot" />
              {dashboard.jobs.some((job) => job.health === 'degraded') ? '有任务需要关注' : '按计划持续检查'}
            </footer>
          </article>
        </section>
      </div>
      <div className="resource-grid">
        <section className="panel pressure-panel" aria-labelledby="pressure-title">
          <header className="panel-heading">
            <h2 id="pressure-title">周限压力</h2>
            <span>当前上游周期</span>
          </header>
          <div className="pressure-summary">
            <div>
              <strong>
                {maxUsage === undefined ? '—' : Math.round(maxUsage)}
                {maxUsage !== undefined && <small>%</small>}
              </strong>
              <span>最高周限使用率</span>
            </div>
            <StatusPill tone={usageTone(maxUsage)}>
              {maxUsage === undefined
                ? '等待样本'
                : maxUsage >= 85
                  ? '接近周限'
                  : maxUsage >= 70
                    ? '留意额度'
                    : '容量充足'}
            </StatusPill>
          </div>
          <div className="pressure-list">
            {accounts.map((account) => {
              const used = account.capacity?.usedPercent
              return (
                <div className="pressure-account" key={account.key}>
                  <div>
                    <span>{account.label}</span>
                    <strong>{percent(used)}</strong>
                  </div>
                  <div
                    className={`pressure-track pressure-track--${usageTone(used)}`}
                    role="meter"
                    aria-label={`${account.label} 周限使用率`}
                    {...(used === undefined
                      ? { 'aria-valuetext': '等待样本' }
                      : { 'aria-valuenow': used, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
                  >
                    <i style={{ width: `${Math.min(100, Math.max(0, used ?? 0))}%` }} />
                  </div>
                  <footer>
                    <span>
                      {used === undefined ? '等待首次容量同步' : `重置于 ${dateTime(account.capacity?.resetAt)}`}
                    </span>
                    <span>{used === undefined ? '—' : `剩余 ${percent(Math.max(0, 100 - used))}`}</span>
                  </footer>
                </div>
              )
            })}
            {!accounts.length && <p className="quiet-empty">添加受管账号后显示资源状态。</p>}
          </div>
        </section>
        <section className="allocation-panel" aria-labelledby="allocation-title">
          <header>
            <h2 id="allocation-title">容量与分配</h2>
            <span>
              USD <ArrowUpRight size={14} />
            </span>
          </header>
          <div className="allocation-total">
            <span>当前可分配总额</span>
            <strong>{currency(totalAllocation)}</strong>
            <small>{coverage(allocationSamples.length)}</small>
          </div>
          <div className="allocation-list">
            {accounts.map((account) => {
              const capacity = account.capacity
              const ratio =
                capacity?.estimatedCycleCapacityUsd && capacity.allocatableCapacityUsd !== undefined
                  ? (capacity.allocatableCapacityUsd / capacity.estimatedCycleCapacityUsd) * 100
                  : 0
              return (
                <div key={account.key} className="allocation-account">
                  <div>
                    <strong>{account.label}</strong>
                    <span>{currency(capacity?.allocatableCapacityUsd)}</span>
                  </div>
                  <div
                    className="allocation-track"
                    title={`周期 ${currency(capacity?.estimatedCycleCapacityUsd)} · 预留 ${currency(capacity?.reserveUsd)}`}
                  >
                    <i style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }} />
                  </div>
                  <footer>
                    <span>预留 {currency(capacity?.reserveUsd)}</span>
                    <span>
                      {capacity?.shareCount ?? '—'} 等份 · 每份 {currency(capacity?.perShareCapacityUsd)}
                    </span>
                  </footer>
                </div>
              )
            })}
          </div>
          <div className="allocation-legend">
            <span>
              <i />
              可分配
            </span>
            <span>
              <i />
              预留
            </span>
            <Link to="/settings">
              配置分配 <ArrowRight size={13} />
            </Link>
          </div>
        </section>
      </div>
      <div className="section-heading">
        <h2>
          账号与家宽链路 <span>{accounts.length}</span>
        </h2>
        <Link className="text-link" to="/accounts">
          管理账号 <ArrowRight size={14} />
        </Link>
      </div>
      <section className="account-links" aria-label="OpenAI 账号与家宽关联">
        {accounts.map((account) => (
          <AccountLink
            key={account.key}
            account={account}
            {...(dashboard.infrastructure.find((item) => item.accountKey === account.key)
              ? { infrastructure: dashboard.infrastructure.find((item) => item.accountKey === account.key)! }
              : {})}
          />
        ))}
        {!accounts.length && (
          <div className="panel empty-state">
            <UsersRound size={26} />
            <strong>还没有受管账号</strong>
            <Link className="button button--primary" to="/settings">
              添加账号
            </Link>
          </div>
        )}
      </section>
      <div className="operations-grid">
        <section className="panel jobs-panel" aria-label="同步任务">
          <header className="panel-heading">
            <h2>同步任务</h2>
            <Clock3 size={16} />
          </header>
          {dashboard.jobs.map((job) => (
            <article key={job.kind} className="job-card">
              <div className="job-card__title">
                <span className="job-icon">{job.kind === 'reset' ? <RefreshCw size={18} /> : <Gauge size={18} />}</span>
                <div>
                  <h3>{job.kind === 'reset' ? '周期重置同步' : '动态容量同步'}</h3>
                  <small>
                    每{' '}
                    {job.kind === 'reset'
                      ? dashboard.config.resetSync.intervalSeconds
                      : dashboard.config.capacitySync.intervalSeconds}{' '}
                    秒检查
                  </small>
                </div>
                <StatusPill tone={jobTone(job)}>{jobLabel(job)}</StatusPill>
              </div>
              <div className="job-card__footer">
                <span>
                  上次 {relativeTime(job.lastCompletedAt)}
                  <small>下次 {relativeTime(job.nextRunAt)}</small>
                </span>
                <Button
                  variant="secondary"
                  busy={run.isPending && run.variables === job.kind}
                  disabled={job.running || run.isPending}
                  onClick={() => run.mutate(job.kind)}
                >
                  <Play size={12} />
                  立即执行
                </Button>
              </div>
            </article>
          ))}
          {notice && (
            <p className="job-notice" role="status">
              {notice}
            </p>
          )}
          {run.error && (
            <p className="inline-error" role="alert">
              {run.error.message}
            </p>
          )}
        </section>
        <section className="panel recent-panel">
          <header className="panel-heading">
            <h2>最近动态</h2>
            <Link className="text-link" to="/activity">
              全部活动 <ArrowRight size={14} />
            </Link>
          </header>
          <ol>
            {dashboard.events.slice(0, 4).map((event) => (
              <li key={event.id}>
                <span className={`recent-dot recent-dot--${event.severity}`}>
                  <CircleDot size={14} />
                </span>
                <div>
                  <strong>{event.summary}</strong>
                  <small>{relativeTime(event.createdAt)}</small>
                </div>
              </li>
            ))}
          </ol>
          {!dashboard.events.length && (
            <div className="empty-state">
              <Activity size={24} />
              <span>任务运行后的记录会显示在这里</span>
            </div>
          )}
        </section>
      </div>
      <footer className="workspace-footnote">
        <span>
          Sub2API 运维控制台 <i /> v{dashboard.service.version}
        </span>
        <span>服务启动于 {dateTime(dashboard.service.startedAt)}</span>
      </footer>
    </>
  )
}
