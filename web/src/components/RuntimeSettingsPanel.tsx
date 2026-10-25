import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
import type { RuntimeSettingsInput } from '@shared/runtime-settings'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { ConfirmDialog } from './Dialog'
import { Button, ErrorPanel, StatusPill } from './ui'
import './RuntimeSettingsPanel.css'

const queryKey = ['runtime-settings']
export function RuntimeSettingsPanel() {
  const cache = useQueryClient()
  const [draft, setDraft] = useState<RuntimeSettingsInput | null>(null)
  const [confirm, setConfirm] = useState(false)
  const query = useQuery({ queryKey, queryFn: api.runtimeSettings,
    refetchInterval: (state) => state.state.data?.applying ? 2000 : 15000,
    refetchIntervalInBackground: false,
  })
  const mutation = useMutation({ mutationFn: (input: RuntimeSettingsInput) => api.applyRuntimeSettings(input),
    onSuccess: (data) => { cache.setQueryData(queryKey, data); setDraft(null); setConfirm(false) },
    onError: () => { void query.refetch() },
  })
  const data = query.data
  const values = draft ?? (data ? { ...data.configured, revision: data.revision } : null)
  const busy = mutation.isPending || Boolean(data?.applying)
  const invalid = !values || !Number.isInteger(values.memoryMiB) || values.memoryMiB < 256 || values.memoryMiB > 768
    || !Number.isInteger(values.dbMaxOpenConnections) || values.dbMaxOpenConnections < 1 || values.dbMaxOpenConnections > 50
  const restart = values && data?.effective && values.dbMaxOpenConnections !== data.effective.dbMaxOpenConnections
  const last = data?.lastApply
  const failed = last && ['failed', 'rolled_back', 'rollback_failed'].includes(last.status)
  return <section className="runtime-settings" aria-label="Sub2API 运行参数">
    <header className="runtime-settings__heading"><div><SlidersHorizontal size={18} aria-hidden="true" /><h2>Sub2API 运行参数</h2></div>
      {data && <StatusPill tone={data.applying ? 'warning' : failed ? 'danger' : 'neutral'}>{data.applying ? '正在应用' : failed ? '上次应用未完成' : '持久配置'}</StatusPill>}
    </header>
    <p>参数保存到服务器，重启后继续生效。修改数据库连接数会重启 Sub2API；只改内存可即时生效。</p>
    {query.error && <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} />}
    {!data && !query.error && <p role="status">读取运行参数…</p>}
    {data && values && <>
      <div className="runtime-settings__fields">
        <label className="field"><span>数据库连接上限</span><input aria-label="数据库连接上限" type="number" min={1} max={50} step={1} disabled={busy} value={Number.isNaN(values.dbMaxOpenConnections) ? '' : values.dbMaxOpenConnections}
          onChange={(event) => setDraft({ ...values, dbMaxOpenConnections: event.target.valueAsNumber })} />
          <small>已保存 {data.configured.dbMaxOpenConnections} · 运行中 {data.effective?.dbMaxOpenConnections ?? '待确认'}；不得小于空闲连接数</small></label>
        <label className="field"><span>内存上限（MiB）</span><input aria-label="内存上限（MiB）" type="number" min={256} max={768} step={1} disabled={busy} value={Number.isNaN(values.memoryMiB) ? '' : values.memoryMiB}
          onChange={(event) => setDraft({ ...values, memoryMiB: event.target.valueAsNumber })} />
          <small>已保存 {data.configured.memoryMiB} MiB · 运行中 {data.effective ? `${data.effective.memoryMiB} MiB` : '待确认'}；范围 256–768 MiB</small></label>
      </div>
      {draft && draft.revision !== data.revision && <p className="form-error" role="alert">服务器配置已变化。请重新载入当前值，再提交修改。</p>}
      {mutation.error && !confirm && <p className="form-error" role="alert">{mutation.error.message}</p>}
      {last && <p className={`runtime-settings__result${failed ? ' form-error' : ''}`} role="status">{last.message}<small>{dateTime(last.finishedAt ?? last.startedAt)} · {last.actor}</small></p>}
      <footer className="runtime-settings__actions"><Button variant="secondary" disabled={busy} onClick={() => { setDraft(null); mutation.reset(); void query.refetch() }}>重新载入当前值</Button>
        <Button busy={busy} disabled={invalid || Boolean(draft && draft.revision !== data.revision)} onClick={() => { mutation.reset(); setConfirm(true) }}>保存并应用</Button></footer>
      {confirm && <ConfirmDialog title="应用 Sub2API 参数" confirmLabel="确认应用" busy={mutation.isPending}
        message={`数据库连接上限 ${values.dbMaxOpenConnections}，内存上限 ${values.memoryMiB} MiB。${restart ? '将重启 Sub2API，当前请求可能短暂中断。' : '无需重启 Sub2API。'}应用失败会尝试恢复原配置。`}
        {...(mutation.error ? { error: mutation.error.message } : {})}
        onClose={() => setConfirm(false)} onConfirm={() => mutation.mutate(values)} />}
    </>}
  </section>
}
