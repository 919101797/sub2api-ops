import { SelectionRail, SelectionIndicator } from '../components/SelectionRail'
import { Fragment, useEffect, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleCheckBig,
  Clock3,
  FileSearch,
  GitBranch,
  Image,
  LockOpen,
  MessageSquareText,
  Search,
  ShieldAlert,
  ShieldCheck,
  TextCursorInput,
  TriangleAlert,
  UsersRound,
  X,
} from 'lucide-react'
import Select, { type MultiValue, type SingleValue } from 'react-select'

import type { PromptAuditRange, PromptAuditRecordSummary, PromptCaptureKind, PromptRiskStatus, ServiceConfig } from '@shared/contracts'
import { Button, ErrorPanel, PageHeading, StatusPill } from '@/components/ui'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'

const ranges: Array<{ value: PromptAuditRange; label: string }> = [
  { value: 'day', label: '24 小时' },
  { value: 'week', label: '7 天' },
  { value: 'month', label: '30 天' },
]

const statuses: Array<{ value: PromptRiskStatus; label: string }> = [
  { value: 'pending', label: '待审核' },
  { value: 'flagged', label: '风险' },
  { value: 'clear', label: '正常' },
  { value: 'not_required', label: '无需审核' },
  { value: 'error', label: '审核异常' },
]

interface FilterOption<T extends string | number> {
  value: T
  label: string
}

interface AppliedPromptFilters {
  statuses: PromptRiskStatus[]
  userId: number | null
  groupId: number | null
  search: string
  startAt: string | null
  endAt: string | null
}

const statusOptions: Array<FilterOption<PromptRiskStatus>> = statuses
const allStatuses = statuses.map((option) => option.value)
const portalStyles = { menuPortal: (base: Record<string, unknown>) => ({ ...base, zIndex: 90 }) }

function statusFilterLabel(selected: PromptRiskStatus[]): string {
  if (selected.length === statuses.length) return '全部状态'
  if (selected.length === 0) return '未选择状态'
  const excluded = statuses.filter((option) => !selected.includes(option.value))
  if (excluded.length === 1) return `不含${excluded[0]!.label}`
  return `已选 ${selected.length} 项`
}

function localDateTimeLabel(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function riskPresentation(status: PromptRiskStatus): { label: string; tone: 'healthy' | 'warning' | 'danger' | 'neutral' } {
  if (status === 'flagged') return { label: '风险', tone: 'danger' }
  if (status === 'clear') return { label: '正常', tone: 'healthy' }
  if (status === 'not_required') return { label: '无需审核', tone: 'neutral' }
  if (status === 'pending') return { label: '待审核', tone: 'warning' }
  return { label: '审核异常', tone: 'warning' }
}

const captureKindLabels: Record<PromptCaptureKind, string> = {
  user: '用户输入',
  assistant: '助手续跑',
  developer: '开发者上下文',
  function_call: '工具调用',
  function_call_output: '工具结果',
  tool: '工具上下文',
  other: '其他续跑上下文',
}

type SessionCategory = 'all' | 'user' | 'assistant' | 'tool' | 'context' | 'media'

const sessionCategories: Array<{ value: SessionCategory; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'user', label: '用户输入' },
  { value: 'assistant', label: '助手续跑' },
  { value: 'tool', label: '工具过程' },
  { value: 'context', label: '系统上下文' },
  { value: 'media', label: '包含图片' },
]

function sessionCategoryMatches(record: PromptAuditRecordSummary, category: SessionCategory): boolean {
  if (category === 'all') return true
  if (category === 'user') return record.captureKind === 'user'
  if (category === 'assistant') return record.captureKind === 'assistant'
  if (category === 'tool') return ['function_call', 'function_call_output', 'tool'].includes(record.captureKind)
  if (category === 'context') return ['developer', 'other'].includes(record.captureKind)
  return record.mediaCount > 0
}

function localDateKey(value: string): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function timelineLabel(value: string, showTime: boolean): string {
  const date = new Date(value)
  return new Intl.DateTimeFormat('zh-CN', showTime
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit' }).format(date)
}

function timelinePlot(values: number[], ceiling: number): Array<{ x: number; y: number }> {
  return values.map((value, index) => ({
    x: values.length <= 1 ? 50 : index / (values.length - 1) * 100,
    y: 96 - value / ceiling * 88,
  }))
}

function timelineLine(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
}

function timelineArea(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  return `M ${points[0]!.x.toFixed(2)} 96 L ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')} L ${points.at(-1)!.x.toFixed(2)} 96 Z`
}

function durationLabel(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} 毫秒`
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)} 秒`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round(durationMs % 60_000 / 1_000)
  if (minutes < 60) return `${minutes} 分 ${seconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

function PromptRecordBody({ record, onOpenSession }: {
  record: PromptAuditRecordSummary
  onOpenSession?: (fingerprint: string) => void
}) {
  const detail = useQuery({ queryKey: ['prompt-detail', record.id], queryFn: () => api.promptDetail(record.id) })
  const risk = riskPresentation(record.riskStatus)
  return <>
    <div className="prompt-drawer__identity">
      <div className="prompt-user-mark" aria-hidden="true">{(record.userEmail || '?').slice(0, 1).toUpperCase()}</div>
      <div><strong>{record.userEmail || '未关联用户'}</strong><span>{record.apiKeyName || '未识别 API Key'} · {record.groupName || '未识别分组'}</span></div>
      <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
    </div>
    {(record.matchedKeyword || record.autoBanned) && <section className="prompt-risk-evidence" aria-label="风险处置依据">
      <TriangleAlert size={17} aria-hidden="true" />
      <div><strong>{record.matchedKeyword ? `命中关键词：${record.matchedKeyword}` : '风控自动处置'}</strong><span>{record.autoBanned ? '该记录曾触发自动封号' : '该记录命中关键词规则'}</span></div>
      {record.autoBanned && <StatusPill tone={record.userStatus === 'disabled' ? 'danger' : 'healthy'}>{record.userStatus === 'disabled' ? '封禁中' : '已解封'}</StatusPill>}
    </section>}
    <dl className="prompt-metadata">
      <div><dt>模型</dt><dd>{record.model}</dd></div>
      <div><dt>采集类型</dt><dd>{captureKindLabels[record.captureKind]}</dd></div>
      <div><dt>{record.fullContentAvailable ? '字符数' : '摘要字符'}</dt><dd>{record.charCount.toLocaleString('zh-CN')}</dd></div>
      <div><dt>采集时间</dt><dd>{dateTime(record.capturedAt)}</dd></div>
      <div><dt>保留到</dt><dd>{dateTime(record.expiresAt)}</dd></div>
      <div><dt>风险分类</dt><dd>{record.riskCategory || '—'}</dd></div>
      <div><dt>风险分数</dt><dd>{record.riskScore === null ? '—' : record.riskScore.toFixed(4)}</dd></div>
      <div><dt>相同调用</dt><dd>{record.occurrenceCount > 1 ? `已合并 ${record.occurrenceCount} 次` : '1 次'}</dd></div>
      <div><dt>会话</dt><dd>{record.sessionFingerprint
        ? onOpenSession
          ? <button type="button" className="prompt-session-link" onClick={() => onOpenSession(record.sessionFingerprint!)}><MessageSquareText size={13} aria-hidden="true" />{record.sessionFingerprint.slice(0, 10)}</button>
          : record.sessionFingerprint.slice(0, 10)
        : '未提供会话标识'}</dd></div>
    </dl>
    <section className="prompt-content">
      <header><div><Braces size={16} aria-hidden="true" /><strong>{record.reviewRequired ? (record.fullContentAvailable ? '完整用户输入' : '历史风控摘要') : '无需审核上下文'}</strong></div><span>{record.fullContentAvailable ? `${record.redacted ? '已自动脱敏' : '未发现凭据'}${record.occurrenceCount > 1 ? ` · 已合并 ${record.occurrenceCount} 次相同调用` : ''}` : '历史记录仅保留 240 字'}</span></header>
      {detail.isPending ? <div className="prompt-detail-loading"><Clock3 size={16} aria-hidden="true" />正在读取完整内容</div>
        : detail.error ? <ErrorPanel message={detail.error.message} onRetry={() => void detail.refetch()} />
          : <pre>{detail.data.promptText}</pre>}
    </section>
    {(detail.data?.media.length ?? 0) > 0 && <section className="prompt-media-gallery" aria-label="请求图片">
      <header><div><Image size={16} aria-hidden="true" /><strong>请求图片</strong></div><span>{detail.data!.media.length} 张 · 点击查看原图</span></header>
      <div>{detail.data!.media.map((media) => <a key={media.id} href={api.promptMediaUrl(media.id)} target="_blank" rel="noreferrer">
        <img src={api.promptMediaUrl(media.id)} alt={`审计图片 ${media.fileName}`} loading="lazy" />
        <span><strong>{media.mimeType.replace('image/', '').toUpperCase()}</strong><small>{(media.byteSize / 1024).toFixed(1)} KB</small></span>
      </a>)}</div>
    </section>}
    <footer className="prompt-drawer__footer"><span>SHA-256</span><code>{record.promptHash || '完整内容未捕获'}</code></footer>
  </>
}

function PromptDrawer({ record, onClose, onOpenSession }: {
  record: PromptAuditRecordSummary
  onClose: () => void
  onOpenSession: (fingerprint: string) => void
}) {
  return (
    <Dialog title="内容详情" kind="drawer" onClose={onClose} className="audit-detail-dialog">
      <div className="audit-detail-body">
        <PromptRecordBody record={record} onOpenSession={onOpenSession} />
      </div>
    </Dialog>
  )
}

function PromptSessionInspector({ record, sequence, total, onClose, onPrevious, onNext }: {
  record: PromptAuditRecordSummary
  sequence: number
  total: number
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [record.id])

  return <Dialog title={`第 ${sequence} 条记录详情`} onClose={onClose} className="audit-inspector-dialog">
    <section className="prompt-session-inspector">
    <header>
      <div><span className="prompt-record-sequence">第 {sequence} / {total} 条</span><h3>{captureKindLabels[record.captureKind]}</h3><span>{record.model} · {dateTime(record.capturedAt)}</span></div>
      <Button variant="quiet" onClick={onClose} aria-label="关闭记录详情"><X size={17} aria-hidden="true" /></Button>
    </header>
    <div ref={bodyRef} className="prompt-session-inspector__body"><PromptRecordBody record={record} /></div>
    <footer className="prompt-session-inspector__nav">
      <Button variant="secondary" disabled={sequence <= 1} onClick={onPrevious}><ChevronUp size={14} aria-hidden="true" />上一条</Button>
      <span>第 {sequence} / {total} 条</span>
      <Button variant="secondary" disabled={sequence >= total} onClick={onNext}>下一条<ChevronDown size={14} aria-hidden="true" /></Button>
    </footer>
    </section>
  </Dialog>
}

function PromptSessionDrawer({ fingerprint, onClose }: {
  fingerprint: string
  onClose: () => void
}) {
  const [category, setCategory] = useState<SessionCategory>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<PromptAuditRecordSummary | null>(null)
  const session = useQuery({ queryKey: ['prompt-session', fingerprint], queryFn: () => api.promptSession(fingerprint) })
  const data = session.data
  const filteredItems = (data?.items ?? []).filter((record) => {
    if (!sessionCategoryMatches(record, category)) return false
    const date = localDateKey(record.capturedAt)
    return (!startDate || date >= startDate) && (!endDate || date <= endDate)
  })
  const categoryCounts = new Map(sessionCategories.map((item) => [
    item.value,
    (data?.items ?? []).filter((record) => sessionCategoryMatches(record, item.value)).length,
  ]))
  const selectedIndex = selectedRecord ? filteredItems.findIndex((record) => record.id === selectedRecord.id) : -1
  const moveSelectedRecord = (delta: number) => {
    const next = filteredItems[selectedIndex + delta]
    if (next) setSelectedRecord(next)
  }
  useEffect(() => {
    if (selectedRecord && selectedIndex < 0) setSelectedRecord(null)
  }, [selectedRecord, selectedIndex])
  useEffect(() => {
    if (!selectedRecord) return
    const handleNavigation = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelectedRecord(-1)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelectedRecord(1)
      }
    }
    window.addEventListener('keydown', handleNavigation)
    return () => window.removeEventListener('keydown', handleNavigation)
  }, [selectedRecord, filteredItems])
  return (
    <Dialog title="会话统计" kind="wide" onClose={onClose} className="audit-session-dialog">
      <div className="audit-session-body">
        <p className="prompt-session-id">{fingerprint.slice(0, 16)}</p>
        {session.isPending ? <div className="prompt-session-loading"><Clock3 size={17} aria-hidden="true" />正在聚合会话记录</div>
          : session.error ? <div className="prompt-session-loading"><ErrorPanel message={session.error.message} onRetry={() => void session.refetch()} /></div>
            : data && <>
              <section className="prompt-session-summary" aria-label="会话摘要">
                <article><span>记录</span><strong>{data.totals.records}</strong><small>{data.totals.reviewed} 条需审核</small></article>
                <article><span>持续时间</span><strong>{durationLabel(data.durationMs)}</strong><small>{dateTime(data.startedAt)} 开始</small></article>
                <article><span>续跑上下文</span><strong>{data.totals.notRequired}</strong><small>工具、结果与助手</small></article>
                <article><span>风险 / 异常</span><strong>{data.totals.flagged} / {data.totals.errors}</strong><small>按 sub2api 审核口径</small></article>
              </section>
              <section className="prompt-session-models">
                <span>涉及模型</span>
                <div>{data.models.map((model) => <span key={model.model}>{model.model}<b>{model.records}</b></span>)}</div>
              </section>
              <section className="prompt-session-filters" aria-label="会话记录筛选">
                <div className="prompt-session-categories">{sessionCategories.map((item) => <button
                  type="button"
                  key={item.value}
                  className={category === item.value ? 'active' : ''}
                  onClick={() => setCategory(item.value)}
                ><span>{item.label}</span><b>{categoryCounts.get(item.value) ?? 0}</b></button>)}</div>
                <div className="prompt-session-dates">
                  <label><span>开始日期</span><input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
                  <i aria-hidden="true" />
                  <label><span>结束日期</span><input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} /></label>
                  {(startDate || endDate) && <button type="button" onClick={() => { setStartDate(''); setEndDate('') }}>清除日期</button>}
                </div>
              </section>
              <div className="prompt-session-workspace">
                <section className="prompt-session-timeline" aria-label="会话记录时间线">
                  <header><strong>对话过程</strong><span>显示 {filteredItems.length} / {data.items.length} 条 · 仅使用客户端显式会话标识聚合</span></header>
                  <div>{filteredItems.map((record, index) => {
                    const risk = riskPresentation(record.riskStatus)
                    const date = localDateKey(record.capturedAt)
                    const previousDate = index > 0 ? localDateKey(filteredItems[index - 1]!.capturedAt) : ''
                    return <Fragment key={record.id}>
                      {date !== previousDate && <div className="prompt-session-date"><CalendarDays size={13} aria-hidden="true" />{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(record.capturedAt))}</div>}
                      <button type="button" className={selectedRecord?.id === record.id ? 'active' : ''} onClick={() => setSelectedRecord(record)}>
                        <i aria-hidden="true" />
                        <span className="prompt-session-timeline__index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="prompt-session-timeline__content"><strong>{captureKindLabels[record.captureKind]}</strong><p>{record.preview}</p><small>{record.model} · {dateTime(record.capturedAt)}{record.mediaCount > 0 ? ` · 图片 ${record.mediaCount}` : ''}</small></span>
                        <StatusPill tone={risk.tone}>{risk.label}</StatusPill>
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </Fragment>
                  })}{filteredItems.length === 0 && <div className="prompt-session-empty-state"><FileSearch size={18} aria-hidden="true" />当前分类和日期范围没有记录</div>}</div>
                </section>
              </div>
              {selectedRecord && selectedIndex >= 0 && <PromptSessionInspector
                record={selectedRecord}
                sequence={selectedIndex + 1}
                total={filteredItems.length}
                onClose={() => setSelectedRecord(null)}
                onPrevious={() => moveSelectedRecord(-1)}
                onNext={() => moveSelectedRecord(1)}
              />}
            </>}
      </div>
    </Dialog>
  )
}

function PromptRow({ record, onOpen, onOpenSession, onUnban, unbanning }: {
  record: PromptAuditRecordSummary
  onOpen: () => void
  onOpenSession: (fingerprint: string) => void
  onUnban: () => void
  unbanning: boolean
}) {
  const risk = riskPresentation(record.riskStatus)
  const canUnban = record.autoBanned && record.userId !== null && record.userStatus === 'disabled'
  const sessionFingerprint = record.sessionFingerprint
  return (
    <article className="prompt-row">
      <button type="button" className="prompt-row__open" onClick={onOpen} aria-label={`查看 ${record.userEmail || '未识别用户'} 的内容详情`} />
      <div className="prompt-row__identity">
        <span className="prompt-user-mark" aria-hidden="true">{(record.userEmail || '?').slice(0, 1).toUpperCase()}</span>
        <span><strong>{record.userEmail || '未关联用户'}</strong><small>{record.groupName || '未识别分组'}{record.groupId ? ` #${record.groupId}` : ''}</small></span>
      </div>
      <div className="prompt-row__content"><p>{record.preview}</p><span>{captureKindLabels[record.captureKind]} · {record.apiKeyName || '未识别 API Key'} · {record.fullContentAvailable ? `${record.charCount.toLocaleString('zh-CN')} 字符` : '历史记录仅保留 240 字'}{record.occurrenceCount > 1 ? ` · 已合并 ${record.occurrenceCount} 次` : ''}{record.mediaCount > 0 ? ` · 图片 ${record.mediaCount}` : ''}</span>{record.matchedKeyword && <mark>命中关键词：{record.matchedKeyword}</mark>}</div>
      <div className="prompt-row__session">{sessionFingerprint
        ? <button type="button" className="prompt-session-chip" onClick={() => onOpenSession(sessionFingerprint)} aria-label={`查看会话 ${sessionFingerprint.slice(0, 8)} 的统计`} title="点击查看会话统计">
          <MessageSquareText size={15} aria-hidden="true" />
          <span><small>查看会话</small><strong>{sessionFingerprint.slice(0, 8)}</strong></span>
        </button>
        : <span className="prompt-session-empty">未提供标识</span>}
      </div>
      <div className="prompt-row__model"><strong>{record.model}</strong><span>{dateTime(record.capturedAt)}</span></div>
      <div className="prompt-row__result"><StatusPill tone={risk.tone}>{risk.label}</StatusPill>{record.autoBanned && <small>自动封号</small>}</div>
      <div className="prompt-row__actions">
        {canUnban && <span className="prompt-unban"><Button variant="secondary" busy={unbanning} onClick={onUnban}><LockOpen size={13} aria-hidden="true" />解封</Button></span>}
        <ArrowRight className="prompt-row__arrow" size={16} aria-hidden="true" />
      </div>
    </article>
  )
}

export function InputHealthPage({ retention }: { retention: ServiceConfig['promptAudit'] }) {
  const [range, setRange] = useState<PromptAuditRange>('day')
  const [selectedStatuses, setSelectedStatuses] = useState<PromptRiskStatus[]>(allStatuses)
  const [userId, setUserId] = useState<number | null>(null)
  const [groupId, setGroupId] = useState<number | null>(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [startAtDraft, setStartAtDraft] = useState('')
  const [endAtDraft, setEndAtDraft] = useState('')
  const [startAt, setStartAt] = useState<string | null>(null)
  const [endAt, setEndAt] = useState<string | null>(null)
  const [timeError, setTimeError] = useState<string | null>(null)
  const [timeRangeOpen, setTimeRangeOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<PromptAuditRecordSummary | null>(null)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [unbanTarget, setUnbanTarget] = useState<PromptAuditRecordSummary | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [appliedFilters, setAppliedFilters] = useState<AppliedPromptFilters>({
    statuses: allStatuses,
    userId: null,
    groupId: null,
    search: '',
    startAt: null,
    endAt: null,
  })
  const [queryRevision, setQueryRevision] = useState(0)
  const timeRangeRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const prompts = useQuery({
    queryKey: ['prompts', range, appliedFilters, page, queryRevision],
    queryFn: () => api.prompts({ range, ...appliedFilters, page }),
    placeholderData: keepPreviousData,
  })
  const filterOptions = useQuery({
    queryKey: ['prompt-filter-options'],
    queryFn: api.promptFilterOptions,
    staleTime: 5 * 60_000,
  })
  const unban = useMutation({
    mutationFn: ({ targetUserId }: { targetUserId: number; email: string }) => api.unbanPromptUser(targetUserId),
    onSuccess: async (_result, input) => {
      setUnbanTarget(null)
      setActionNotice(`${input.email || `用户 #${input.targetUserId}`} 已解除风控封禁。`)
      await queryClient.invalidateQueries({ queryKey: ['prompts'] })
    },
    onError: () => setActionNotice(null),
  })
  const data = prompts.data
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 30)))
  const customDuration = appliedFilters.startAt && appliedFilters.endAt
    ? Date.parse(appliedFilters.endAt) - Date.parse(appliedFilters.startAt)
    : null
  const timelineShowsTime = customDuration === null ? range === 'day' : customDuration <= 48 * 60 * 60 * 1_000
  const timeline = (data?.timeline ?? []).map((point) => ({ ...point, label: timelineLabel(point.bucket, timelineShowsTime) }))
  const timelineCeiling = Math.max(1, ...timeline.flatMap((point) => [point.pending, point.clear, point.flagged, point.notRequired]))
  const pendingPoints = timelinePlot(timeline.map((point) => point.pending), timelineCeiling)
  const clearPoints = timelinePlot(timeline.map((point) => point.clear), timelineCeiling)
  const flaggedPoints = timelinePlot(timeline.map((point) => point.flagged), timelineCeiling)
  const notRequiredPoints = timelinePlot(timeline.map((point) => point.notRequired), timelineCeiling)
  const timelineLabelStep = Math.max(1, Math.ceil(timeline.length / 5))
  const userOptions: Array<FilterOption<number>> = (filterOptions.data?.users ?? []).map((user) => ({
    value: user.id,
    label: `${user.email} · ID ${user.id}`,
  }))
  const groupOptions: Array<FilterOption<number>> = (filterOptions.data?.groups ?? []).map((group) => ({
    value: group.id,
    label: `#${group.id} · ${group.name}`,
  }))
  const selectedStatusOptions = statusOptions.filter((option) => selectedStatuses.includes(option.value))
  const timeRangeLabel = startAt && endAt
    ? `${localDateTimeLabel(startAt)} — ${localDateTimeLabel(endAt)}`
    : '选择日期时间范围'

  const selectStatuses = (options: MultiValue<FilterOption<PromptRiskStatus>>) => {
    setSelectedStatuses(options.map((option) => option.value))
  }
  const selectRange = (value: PromptAuditRange) => {
    setPage(1)
    setRange(value)
    setStartAtDraft('')
    setEndAtDraft('')
    setStartAt(null)
    setEndAt(null)
    setAppliedFilters((current) => ({ ...current, startAt: null, endAt: null }))
    setTimeError(null)
  }
  const applyCustomTime = () => {
    if (!startAtDraft || !endAtDraft) {
      setTimeError('请同时选择开始日期时间和结束日期时间。')
      return false
    }
    const start = new Date(startAtDraft)
    const end = new Date(endAtDraft)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      setTimeError('日期时间格式无效。')
      return false
    }
    if (start.getTime() > end.getTime()) {
      setTimeError('结束日期时间不能早于开始日期时间。')
      return false
    }
    setStartAt(start.toISOString())
    setEndAt(end.toISOString())
    setTimeError(null)
    return true
  }
  const clearCustomTime = () => {
    setStartAtDraft('')
    setEndAtDraft('')
    setStartAt(null)
    setEndAt(null)
    setTimeError(null)
  }
  const applyFilters = () => {
    setAppliedFilters({
      statuses: selectedStatuses,
      userId,
      groupId,
      search: searchDraft.trim(),
      startAt,
      endAt,
    })
    setPage(1)
    setQueryRevision((value) => value + 1)
  }

  useEffect(() => {
    if (!timeRangeOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (timeRangeRef.current && !timeRangeRef.current.contains(event.target as Node)) setTimeRangeOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTimeRangeOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [timeRangeOpen])
  const confirmUnban = (record: PromptAuditRecordSummary) => { unban.reset(); setUnbanTarget(record) }

  return (
    <>
      <PageHeading
        title="输入健康"
        actions={<div className="retention-note"><ShieldCheck size={15} aria-hidden="true" /><span>正常 {retention.normalRetentionDays} 天</span><i /> <span>风险 {retention.riskRetentionDays} 天</span></div>}
      />

      {prompts.error && data && <div className="stale-data-notice" role="alert">查询失败，保留上次查询结果。<button type="button" onClick={() => void prompts.refetch()}>重试</button></div>}
      {prompts.error && !data ? <div className="prompt-page-error"><ErrorPanel message={prompts.error.message} onRetry={() => void prompts.refetch()} /></div> : (
        <>
          <section className="prompt-stat-card" aria-label="提示词审计摘要" aria-busy={prompts.isPending}>
            <article><div className="prompt-stat__icon"><TextCursorInput size={18} aria-hidden="true" /></div><div className="prompt-stat__copy"><span>全部记录</span><strong>{data?.totals.records.toLocaleString('zh-CN') ?? '—'}</strong><small>其中 {data?.totals.reviewed ?? 0} 条需要审核</small></div></article>
            <article><div className="prompt-stat__icon prompt-stat__icon--danger"><TriangleAlert size={18} aria-hidden="true" /></div><div className="prompt-stat__copy"><span>风险命中</span><strong>{data?.totals.flagged.toLocaleString('zh-CN') ?? '—'}</strong><small>延长保留 {retention.riskRetentionDays} 天</small></div></article>
            <article><div className="prompt-stat__icon prompt-stat__icon--muted"><GitBranch size={18} aria-hidden="true" /></div><div className="prompt-stat__copy"><span>无需审核</span><strong>{data?.totals.notRequired.toLocaleString('zh-CN') ?? '—'}</strong><small>工具、结果与助手续跑</small></div></article>
            <article><div className="prompt-stat__icon"><UsersRound size={18} aria-hidden="true" /></div><div className="prompt-stat__copy"><span>关联用户</span><strong>{data?.totals.users.toLocaleString('zh-CN') ?? '—'}</strong><small>按 sub2api 身份去重</small></div></article>
            <article><div className="prompt-stat__icon prompt-stat__icon--muted"><ShieldAlert size={18} aria-hidden="true" /></div><div className="prompt-stat__copy"><span>审核异常</span><strong>{data?.totals.error.toLocaleString('zh-CN') ?? '—'}</strong><small>风控上游调用异常</small></div></article>
          </section>

          <section className="prompt-visual">
            <header><h2>内容趋势与风险信号</h2><SelectionRail className="range-switch" role="group" aria-label="时间范围">{ranges.map((item) => <button key={item.value} type="button" aria-pressed={!startAt && !endAt && range === item.value} className={!startAt && !endAt && range === item.value ? 'active' : ''} onClick={() => selectRange(item.value)}><SelectionIndicator active={!startAt && !endAt && range === item.value} />{item.label}</button>)}</SelectionRail></header>
            <div className="prompt-visual__body">
              <div className="prompt-chart" role="img" aria-label="输入记录趋势">
                {timeline.length > 0 ? <div className="prompt-native-chart">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <linearGradient id="promptClear" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--olive)" stopOpacity=".34" /><stop offset="100%" stopColor="var(--olive)" stopOpacity=".02" /></linearGradient>
                      <linearGradient id="promptFlagged" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--danger)" stopOpacity=".38" /><stop offset="100%" stopColor="var(--danger)" stopOpacity=".02" /></linearGradient>
                      <linearGradient id="promptNotRequired" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--neutral-series)" stopOpacity=".2" /><stop offset="100%" stopColor="var(--neutral-series)" stopOpacity=".01" /></linearGradient>
                      <linearGradient id="promptPending" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--warning-series)" stopOpacity=".26" /><stop offset="100%" stopColor="var(--warning-series)" stopOpacity=".01" /></linearGradient>
                    </defs>
                    <g className="prompt-native-chart__grid"><line x1="0" y1="8" x2="100" y2="8" /><line x1="0" y1="30" x2="100" y2="30" /><line x1="0" y1="52" x2="100" y2="52" /><line x1="0" y1="74" x2="100" y2="74" /><line x1="0" y1="96" x2="100" y2="96" /></g>
                    <path className="prompt-native-chart__area prompt-native-chart__area--clear" d={timelineArea(clearPoints)} />
                    <path className="prompt-native-chart__area prompt-native-chart__area--flagged" d={timelineArea(flaggedPoints)} />
                    <path className="prompt-native-chart__area prompt-native-chart__area--not-required" d={timelineArea(notRequiredPoints)} />
                    <path className="prompt-native-chart__area prompt-native-chart__area--pending" d={timelineArea(pendingPoints)} />
                    <polyline className="prompt-native-chart__line prompt-native-chart__line--clear" points={timelineLine(clearPoints)} />
                    <polyline className="prompt-native-chart__line prompt-native-chart__line--flagged" points={timelineLine(flaggedPoints)} />
                    <polyline className="prompt-native-chart__line prompt-native-chart__line--not-required" points={timelineLine(notRequiredPoints)} />
                    <polyline className="prompt-native-chart__line prompt-native-chart__line--pending" points={timelineLine(pendingPoints)} />
                  </svg>
                  <div className="prompt-native-chart__labels">{timeline.map((point, index) => (
                    (index % timelineLabelStep === 0 || index === timeline.length - 1) && <span key={point.bucket} style={{ left: `${timeline.length <= 1 ? 50 : index / (timeline.length - 1) * 100}%` }}>{point.label}</span>
                  ))}</div>
                  <div className="prompt-native-chart__legend"><span><i />正常</span><span><i />风险</span><span><i />无需审核</span><span><i />待审核</span></div>
                </div> : <div className="prompt-chart__empty"><FileSearch size={20} aria-hidden="true" /><span>当前时间范围还没有内容记录</span></div>}
              </div>
              <div className="prompt-risk-readout">
                <p>风险密度</p>
                <strong>{data?.totals.reviewed ? `${(data.totals.flagged / data.totals.reviewed * 100).toFixed(2)}%` : '0.00%'}</strong>
                <span>风险命中记录占当前时间范围内全部审核记录的比例。</span>
                <div className="risk-scale"><i style={{ width: `${Math.min(100, data?.totals.reviewed ? data.totals.flagged / data.totals.reviewed * 100 : 0)}%` }} /></div>
                <dl><div><dt><CircleCheckBig size={14} aria-hidden="true" />正常</dt><dd>{data?.totals.clear ?? 0}</dd></div><div><dt><TriangleAlert size={14} aria-hidden="true" />风险</dt><dd>{data?.totals.flagged ?? 0}</dd></div><div><dt><GitBranch size={14} aria-hidden="true" />无需审核</dt><dd>{data?.totals.notRequired ?? 0}</dd></div><div><dt><Clock3 size={14} aria-hidden="true" />待审核</dt><dd>{data?.totals.pending ?? 0}</dd></div><div><dt><ShieldAlert size={14} aria-hidden="true" />异常</dt><dd>{data?.totals.error ?? 0}</dd></div></dl>
              </div>
            </div>
          </section>

          <section className="prompt-records">
            <header className="prompt-records__toolbar">
              <h2>审核与续跑记录</h2>
              <form className="prompt-search" onSubmit={(event) => { event.preventDefault(); applyFilters() }}>
                <Search size={15} aria-hidden="true" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索用户、分组、模型或输入内容" aria-label="搜索审计记录" /><button type="submit">检索</button>
              </form>
            </header>
            <div className="prompt-filters" aria-label="审计记录过滤条件">
              <label><span>审核状态</span><Select<FilterOption<PromptRiskStatus>, true>
                className="prompt-filter-select"
                classNamePrefix="ops-select"
                value={selectedStatusOptions}
                options={statusOptions}
                onChange={selectStatuses}
                isMulti
                isSearchable
                closeMenuOnSelect={false}
                hideSelectedOptions={false}
                controlShouldRenderValue={false}
                menuPosition="fixed"
                menuPortalTarget={document.body}
                styles={portalStyles}
                placeholder={statusFilterLabel(selectedStatuses)}
                noOptionsMessage={() => '没有匹配状态'}
                aria-label="按审核状态过滤"
              /></label>
              <label><span>用户</span><Select<FilterOption<number>, false>
                className="prompt-filter-select"
                classNamePrefix="ops-select"
                value={userOptions.find((option) => option.value === userId) ?? null}
                options={userOptions}
                onChange={(option: SingleValue<FilterOption<number>>) => setUserId(option?.value ?? null)}
                isSearchable
                isClearable
                isLoading={filterOptions.isLoading}
                menuPosition="fixed"
                menuPortalTarget={document.body}
                styles={portalStyles}
                placeholder="全部用户"
                noOptionsMessage={() => '没有匹配用户'}
                loadingMessage={() => '正在读取用户…'}
                aria-label="按用户过滤"
              /></label>
              <label><span>分组</span><Select<FilterOption<number>, false>
                className="prompt-filter-select"
                classNamePrefix="ops-select"
                value={groupOptions.find((option) => option.value === groupId) ?? null}
                options={groupOptions}
                onChange={(option: SingleValue<FilterOption<number>>) => setGroupId(option?.value ?? null)}
                isSearchable
                isClearable
                isLoading={filterOptions.isLoading}
                menuPosition="fixed"
                menuPortalTarget={document.body}
                styles={portalStyles}
                placeholder="全部分组"
                noOptionsMessage={() => '没有匹配分组'}
                loadingMessage={() => '正在读取分组…'}
                aria-label="按分组过滤"
              /></label>
              <div className="prompt-time-range" ref={timeRangeRef}>
                <span>日期时间范围</span>
                <button
                  type="button"
                  className={`prompt-time-range__trigger${startAt && endAt ? ' prompt-time-range__trigger--active' : ''}`}
                  aria-haspopup="dialog"
                  aria-expanded={timeRangeOpen}
                  onClick={() => setTimeRangeOpen((value) => !value)}
                >
                  <CalendarDays size={14} aria-hidden="true" />
                  <span>{timeRangeLabel}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {timeRangeOpen && <div className="prompt-time-range__popover" role="dialog" aria-label="选择日期时间范围">
                  <header><strong>精确时间范围</strong><span>按当前浏览器时区选择</span></header>
                  <div className="prompt-time-range__fields">
                    <label className="prompt-time-field"><span>开始日期时间</span><input
                      type="datetime-local"
                      step="60"
                      value={startAtDraft}
                      max={endAtDraft || undefined}
                      onChange={(event) => { setStartAtDraft(event.target.value); setTimeError(null) }}
                      aria-label="开始日期时间"
                    /></label>
                    <label className="prompt-time-field"><span>结束日期时间</span><input
                      type="datetime-local"
                      step="60"
                      value={endAtDraft}
                      min={startAtDraft || undefined}
                      onChange={(event) => { setEndAtDraft(event.target.value); setTimeError(null) }}
                      aria-label="结束日期时间"
                    /></label>
                  </div>
                  {timeError && <div className="prompt-time-range__error" role="alert">{timeError}</div>}
                  <footer>
                    <Button type="button" variant="quiet" disabled={!startAtDraft && !endAtDraft && !startAt && !endAt} onClick={clearCustomTime}>清除范围</Button>
                    <Button type="button" onClick={() => { if (applyCustomTime()) setTimeRangeOpen(false) }}><CalendarDays size={14} aria-hidden="true" />确认时间</Button>
                  </footer>
                </div>}
              </div>
              <Button className="prompt-filter-submit" busy={prompts.isFetching} aria-label="查询审计记录" onClick={applyFilters}><Search size={14} aria-hidden="true" />查询</Button>
            </div>
            {filterOptions.error && <div className="form-error prompt-action-error" role="alert">无法读取 sub2api 用户与分组：{filterOptions.error.message}</div>}
            {actionNotice && <div className="prompt-action-notice" role="status">{actionNotice}</div>}
            {unban.error && <div className="form-error prompt-action-error" role="alert">解封失败：{unban.error.message}</div>}
            <div className="prompt-list" data-no-swipe aria-busy={prompts.isFetching}>
              <div className="prompt-list__head"><span>用户 / 分组</span><span>内容摘要</span><span>会话统计</span><span>模型 / 时间</span><span>状态</span><span>操作</span></div>
              {(data?.items ?? []).map((record) => <PromptRow
                key={record.id}
                record={record}
                onOpen={() => setSelected(record)}
                onOpenSession={(fingerprint) => setSelectedSession(fingerprint)}
                onUnban={() => confirmUnban(record)}
                unbanning={unban.isPending && unban.variables?.targetUserId === record.userId}
              />)}
              {!prompts.isPending && (data?.items.length ?? 0) === 0 && <div className="prompt-list__empty"><FileSearch size={21} aria-hidden="true" /><strong>没有匹配的审计记录</strong><span>调整时间范围、状态或搜索条件后再试。</span></div>}
            </div>
            <footer className="prompt-pagination"><span>共 {data?.total ?? 0} 条 · 第 {page} / {pages} 页</span><div><Button variant="secondary" disabled={page <= 1 || prompts.isFetching} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={14} aria-hidden="true" />上一页</Button><Button variant="secondary" disabled={page >= pages || prompts.isFetching} onClick={() => setPage((value) => value + 1)}>下一页<ArrowRight size={14} aria-hidden="true" /></Button></div></footer>
          </section>
        </>
      )}
      {unbanTarget && <ConfirmDialog title="解除风控封禁" message={`确认解除 ${unbanTarget.userEmail || `用户 #${unbanTarget.userId}`} 的风控封禁？解封后该用户可恢复访问。`} confirmLabel="确认解封" busy={unban.isPending} {...(unban.error ? { error: unban.error.message } : {})} onClose={() => setUnbanTarget(null)} onConfirm={() => { if (unbanTarget.userId !== null && !unban.isPending) { setActionNotice(null); unban.mutate({ targetUserId: unbanTarget.userId, email: unbanTarget.userEmail }) } }} />}
      {selected && <PromptDrawer
        record={selected}
        onClose={() => setSelected(null)}
        onOpenSession={(fingerprint) => { setSelected(null); setSelectedSession(fingerprint) }}
      />}
      {selectedSession && <PromptSessionDrawer
        fingerprint={selectedSession}
        onClose={() => setSelectedSession(null)}
      />}
    </>
  )
}
