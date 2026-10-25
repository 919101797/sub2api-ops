import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Select from 'react-select'
import { Plus, Trash2, ShieldCheck } from 'lucide-react'
import type { RequestLimitsInput } from '@shared/request-limits'
import type { SettingsOptionsResponse } from '@shared/contracts'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { Button, ErrorPanel, StatusPill } from './ui'
import './RuntimeSettingsPanel.css'
import './RequestLimitsPanel.css'

const queryKey = ['request-limits']
export function RequestLimitsPanel({ users }: { users: SettingsOptionsResponse['users'] }) {
  const cache = useQueryClient()
  const [draft, setDraft] = useState<RequestLimitsInput | null>(null)
  const query = useQuery({ queryKey, queryFn: api.requestLimits, refetchInterval: 15000, refetchIntervalInBackground: false })
  const save = useMutation({ mutationFn: api.saveRequestLimits, onSuccess: data => { cache.setQueryData(queryKey, data); setDraft(null) } })
  const data = query.data
  const values = draft ?? (data ? { revision: data.revision, defaultMaxMiB: data.policy.defaultMaxMiB,
    largeThresholdMiB: data.policy.largeThresholdMiB, maxLargeConcurrent: data.policy.maxLargeConcurrent, userOverrides: data.policy.userOverrides } : null)
  const stale = Boolean(draft && data && draft.revision !== data.revision)
  const set = (change: Partial<RequestLimitsInput>) => { if (values) { setDraft({ ...values, ...change }); save.reset() } }
  const submit = (event: FormEvent) => { event.preventDefault(); if (values && !stale) save.mutate(values) }
  return <section className="runtime-settings request-limits" aria-label="用户请求大小限制">
    <header className="runtime-settings__heading"><div><ShieldCheck size={18} aria-hidden="true" /><h2>用户请求大小限制</h2></div><StatusPill tone="neutral">保存后生效</StatusPill></header>
    <p>按解压后的完整请求大小检查，HTTP、上下文压缩和 WebSocket 共用用户设置。同一用户的所有 API Key 使用相同上限。</p>
    {query.error && <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} />}
    {!data && !query.error && <p role="status">读取请求限制…</p>}
    {data && values && <form onSubmit={submit}>
      <div className="runtime-settings__fields">
        <label className="field"><span>默认请求上限（MiB）</span><input aria-label="默认请求上限（MiB）" type="number" min={1} max={100} step={1} required value={Number.isNaN(values.defaultMaxMiB) ? '' : values.defaultMaxMiB} onChange={e => set({ defaultMaxMiB: e.target.valueAsNumber })} /><small>没有独立设置的用户使用此值，范围 1–100 MiB。</small></label>
        <label className="field"><span>大请求阈值（MiB）</span><input aria-label="大请求阈值（MiB）" type="number" min={1} max={100} step={1} required value={Number.isNaN(values.largeThresholdMiB) ? '' : values.largeThresholdMiB} onChange={e => set({ largeThresholdMiB: e.target.valueAsNumber })} /><small>超过阈值的请求受下方并发数保护。</small></label>
        <label className="field"><span>大请求并发上限</span><input aria-label="大请求并发上限" type="number" min={1} step={1} required value={Number.isNaN(values.maxLargeConcurrent) ? '' : values.maxLargeConcurrent} onChange={e => set({ maxLargeConcurrent: e.target.valueAsNumber })} /><small>全服务器共用，可填写任意正整数。达到所设并发数时返回 429；数值越大，内存需求越高。</small></label>
      </div>
      <div className="request-limits__subheading"><h3>用户独立上限</h3><Button variant="secondary" disabled={save.isPending} onClick={() => set({ userOverrides: [...values.userOverrides, { userId: 0, maxMiB: values.defaultMaxMiB }] })}><Plus size={15} />添加用户</Button></div>
      {!values.userOverrides.length && <p className="request-limits__empty">所有用户当前使用默认上限。</p>}
      {values.userOverrides.map((row, index) => {
        const user = users.find(u => u.id === row.userId)
        const options = users.filter(u => u.status === 'active' && !values.userOverrides.some((other, i) => i !== index && other.userId === u.id)).map(u => ({ value: u.id, label: `${u.username || u.email} · ${u.email} · #${u.id}` }))
        return <div className="request-limits__row" key={index}>
          <label className="field"><span>用户 {index + 1}</span><Select inputId={`request-user-${index}`} aria-label={`用户 ${index + 1}`} className="select-control" classNamePrefix="ops-select" options={options} value={row.userId ? { value: row.userId, label: user ? `${user.username || user.email} · ${user.email} · #${user.id}` : `用户 #${row.userId}` } : null} onChange={option => set({ userOverrides: values.userOverrides.map((v,i) => i === index ? { ...v, userId: option?.value ?? 0 } : v) })} placeholder="选择 Sub2API 用户" isDisabled={save.isPending} /></label>
          <label className="field"><span>请求上限（MiB）</span><input aria-label={`用户 ${row.userId || index + 1} 的请求上限（MiB）`} type="number" min={1} max={100} step={1} required value={Number.isNaN(row.maxMiB) ? '' : row.maxMiB} onChange={e => set({ userOverrides: values.userOverrides.map((v,i) => i === index ? { ...v, maxMiB: e.target.valueAsNumber } : v) })} /></label>
          <Button variant="quiet" aria-label={`移除用户 ${row.userId || index + 1} 的独立上限`} disabled={save.isPending} onClick={() => set({ userOverrides: values.userOverrides.filter((_,i) => i !== index) })}><Trash2 size={16} /></Button>
        </div>
      })}
      <p className="request-limits__hint">大额用户的 WebSocket 连接会占用一个大请求通道，断开后释放。修改设置后，已有连接在下一次输入时重连。</p>
      {stale && <p className="form-error" role="alert">服务器策略已变化，请重新载入后保存。</p>}
      {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
      {save.isSuccess && <p className="save-notice" role="status">请求限制已保存，新请求立即生效。</p>}
      <small>最近保存：{dateTime(data.policy.updatedAt)} · {data.policy.updatedBy}</small>
      <footer className="runtime-settings__actions"><Button variant="secondary" disabled={save.isPending} onClick={() => { setDraft(null); save.reset(); void query.refetch() }}>重新载入当前值</Button><Button type="submit" busy={save.isPending} disabled={!draft || stale || values.userOverrides.some(row => row.userId === 0)}>保存请求限制</Button></footer>
    </form>}
  </section>
}
