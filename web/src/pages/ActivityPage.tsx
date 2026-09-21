import { SelectionRail, SelectionIndicator } from '../components/SelectionRail'
import { useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  Calculator,
  FileSearch,
  Gauge,
  KeyRound,
  Settings2,
  Search,
  ChevronDown,
} from 'lucide-react'
import type { AuditEvent, DashboardResponse } from '@shared/contracts'
import { Disclosure } from '@/components/Disclosure'
import { Button, PageHeading, StatusPill } from '@/components/ui'
import { dateTime } from '@/lib/format'

const categoryLabels: Record<AuditEvent['category'], string> = {
  system: '系统',
  auth: '身份验证',
  reset: '周期重置',
  capacity: '容量同步',
  concurrency: '峰谷策略',
  configuration: '配置变更',
  prompt_audit: '提示词审计',
}
function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false)
  const Icon =
    event.category === 'reset'
      ? ArrowDownToLine
      : event.category === 'capacity'
        ? Calculator
        : event.category === 'concurrency'
          ? Gauge
          : event.category === 'auth'
            ? KeyRound
            : event.category === 'prompt_audit'
              ? FileSearch
              : Settings2
  return (
    <li className="event-row">
      <span className={`event-icon event-icon--${event.severity}`}>
        <Icon size={17} />
      </span>
      <div className="event-copy">
        <div>
          <StatusPill
            tone={
              event.severity === 'error'
                ? 'danger'
                : event.severity === 'warning'
                  ? 'warning'
                  : event.severity === 'success'
                    ? 'healthy'
                    : 'neutral'
            }
          >
            {categoryLabels[event.category]}
          </StatusPill>
          <time>{dateTime(event.createdAt)}</time>
        </div>
        <strong>{event.summary}</strong>
        {event.accountKey && <span className="event-account">账号 · {event.accountKey}</span>}
        {event.details && (
          <>
            <button
              type="button"
              className="evidence-toggle"
              aria-expanded={open}
              aria-controls={`event-${event.id}`}
              onClick={() => setOpen(!open)}
            >
              决策证据 <ChevronDown size={14} />
            </button>
            <Disclosure open={open} id={`event-${event.id}`}>
              <pre>{JSON.stringify(event.details, null, 2)}</pre>
            </Disclosure>
          </>
        )}
      </div>
    </li>
  )
}
export function ActivityPage({ dashboard }: { dashboard: DashboardResponse }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState('all')
  const events = dashboard.events.filter(
    (event) =>
      (category === 'all' || event.category === category) &&
      (severity === 'all' ||
        (severity === 'attention' && (event.severity === 'error' || event.severity === 'warning'))) &&
      `${event.summary} ${event.accountKey ?? ''} ${categoryLabels[event.category]}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  )
  return (
    <>
      <PageHeading title="自动化活动" actions={<span className="record-limit">最多保留 500 条</span>} />
      <div className="activity-summary">
        <div>
          <span className="activity-summary__icon">
            <Activity size={20} />
          </span>
          <span>
            近期活动
            <strong>
              {dashboard.events.length}
              <small>条记录</small>
            </strong>
          </span>
        </div>
        <div>
          <span>
            执行成功<strong>{dashboard.events.filter((event) => event.severity === 'success').length}</strong>
          </span>
          <span>
            需要关注
            <strong>
              {dashboard.events.filter((event) => event.severity === 'warning' || event.severity === 'error').length}
            </strong>
          </span>
        </div>
      </div>
      <div className="module-toolbar">
        <label className="filter-search">
          <Search size={16} />
          <input
            aria-label="搜索活动"
            placeholder="搜索活动或账号标识"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="activity-filters">
          <select aria-label="活动类别" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">全部类别</option>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <SelectionRail className="segmented-control" role="group" aria-label="活动级别">
            <button type="button" aria-pressed={severity === 'all'} onClick={() => setSeverity('all')}>
              <SelectionIndicator active={severity === 'all'} />全部活动
            </button>
            <button type="button" aria-pressed={severity === 'attention'} onClick={() => setSeverity('attention')}>
              <SelectionIndicator active={severity === 'attention'} />需要关注
            </button>
          </SelectionRail>
        </div>
      </div>
      <section className="panel timeline-frame">
        <header className="timeline-summary">
          <h2>活动记录</h2>
          <span>{events.length} 条匹配</span>
        </header>
        <ol className="event-list" key={`${search}-${category}-${severity}`}>
          {events.map((event) => (
            <EventRow event={event} key={event.id} />
          ))}
        </ol>
        {!events.length && (
          <div className="empty-state">
            <Activity size={26} />
            <strong>{dashboard.events.length ? '没有匹配的活动' : '等待第一条活动'}</strong>
            <span>
              {dashboard.events.length ? '试试其他关键词或筛选条件。' : '任务运行后，执行与决策证据会出现在这里。'}
            </span>
            {dashboard.events.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('')
                  setCategory('all')
                  setSeverity('all')
                }}
              >
                清空筛选
              </Button>
            )}
          </div>
        )}
      </section>
    </>
  )
}
