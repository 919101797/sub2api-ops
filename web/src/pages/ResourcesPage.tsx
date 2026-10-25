import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Server } from 'lucide-react'
import type { ResourcePoint } from '@shared/resources'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { Button, ErrorPanel, PageHeading, StatusPill } from '@/components/ui'
import { RuntimeSettingsPanel } from '@/components/RuntimeSettingsPanel'
import './ResourcesPage.css'

const mib = (value: number) => `${(value / 1048576).toFixed(1)} MB`
const nullable = (value: number | null | undefined, format = mib) => value === null || value === undefined ? '—' : format(value)
function localDate(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
function Trend({ title, points, value, format }: { title: string; points: ResourcePoint[]; value: (point: ResourcePoint) => number | null; format: (n: number) => string }) {
  const values = points.flatMap((point) => value(point) === null ? [] : [value(point)!])
  const ceiling = Math.max(1, ...values)
  const start = points.length ? Date.parse(points[0]!.at) : 0
  const span = points.length ? Math.max(15000, Date.parse(points.at(-1)!.at) - start) : 1
  let drawing = false
  const coordinates = points.map((point) => {
    const yValue = value(point)
    if (yValue === null) { drawing = false; return null }
    const x = 12 + (Date.parse(point.at) - start) / span * 696
    const y = 150 - yValue / ceiling * 125
    const move = !drawing || point.gap
    drawing = true
    return { x, y, move, label: `${dateTime(point.at)} · ${format(yValue)}` }
  })
  return <section className="resource-chart" aria-label={title}>
    <header><h2>{title}</h2><span>区间极值 {values.length ? format(title === '可用内存' ? Math.min(...values) : Math.max(...values)) : '—'}</span></header>
    <svg viewBox="0 0 720 170" role="img" aria-label={`${title}历史曲线，采样断档不连线`}>
      {[25, 87, 150].map((y) => <line key={y} x1="12" x2="708" y1={y} y2={y} className="resource-chart__grid" />)}
      <path d={coordinates.filter((p) => p !== null).map((p) => `${p.move ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} className="resource-chart__line" />
      {coordinates.map((point, index) => point && <circle key={index} cx={point.x} cy={point.y} r="2.2" className="resource-chart__point"><title>{point.label}</title></circle>)}
    </svg>
    <footer><span>{points.length ? dateTime(points[0]!.at) : '等待采样'}</span><span>{points.length ? dateTime(points.at(-1)!.lastAt) : ''}</span></footer>
  </section>
}
export function ResourcesPage() {
  const [hours, setHours] = useState(1)
  const [fixed, setFixed] = useState<{ start: string; end: string } | null>(null)
  const [start, setStart] = useState(localDate(new Date(Date.now() - 3600000)))
  const [end, setEnd] = useState(localDate(new Date()))
  const [formError, setFormError] = useState('')
  const [container, setContainer] = useState('sub2api')
  const query = useQuery({
    queryKey: ['resources', hours, fixed],
    queryFn: () => {
      const until = fixed?.end ?? new Date().toISOString()
      return api.resources(fixed?.start ?? new Date(Date.parse(until) - hours * 3600000).toISOString(), until)
    },
    refetchInterval: fixed ? false : 15000,
    refetchIntervalInBackground: false,
  })
  const data = query.data
  const latest = data?.latest
  const points = data?.points ?? []
  const submit = () => {
    if (!start || !end || Date.parse(start) >= Date.parse(end) || Date.parse(end) - Date.parse(start) > 7 * 86400000) { setFormError('请选择不超过七天且开始早于结束的时间'); return }
    setFormError('')
    setFixed({ start: new Date(start).toISOString(), end: new Date(end).toISOString() })
  }
  const names = [...new Set(points.flatMap((point) => Object.keys(point.containers)))].sort()
  const peak = (name: string) => points.reduce((n, point) => Math.max(n, point.containers[name] ?? 0), 0)
  const latencies = latest?.disks.flatMap((disk) => [disk.readAwaitMs, disk.writeAwaitMs]).filter((n): n is number => n !== null) ?? []
  const awaitMs = latencies.length ? Math.max(...latencies) : null
  return <div className="resources-page">
    <PageHeading title="资源监控" actions={<Button variant="secondary" busy={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14} />刷新数据</Button>} />
    <section className="resource-intro">
      <Server size={28} aria-hidden="true" /><div><strong>每一段资源变化，都有迹可循。</strong><p>15 秒采样 · 保留 7 天</p></div>
      <StatusPill tone={data && !data.stale ? 'healthy' : 'warning'}>{data && !data.stale ? '独立采样运行中' : '等待有效采样'}</StatusPill>
    </section>
    {query.error && <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} />}
    {data?.stale && <p className="form-error" role="alert">采样中断：最近 45 秒没有新记录，请检查宿主机采样服务。</p>}
    <RuntimeSettingsPanel />
    <div className="resource-toolbar">
      <div className="resource-presets">{[1, 6, 24, 168].map((n) => <Button key={n} variant={hours === n && !fixed ? 'primary' : 'secondary'} onClick={() => { setHours(n); setFixed(null) }}>{n === 168 ? '7 天' : `${n} 小时`}</Button>)}</div>
      <label>开始时间<input aria-label="开始时间" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label>结束时间<input aria-label="结束时间" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <Button variant="secondary" onClick={submit}>查询历史</Button>
    </div>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <section className="metric-grid resource-metrics" aria-label="当前宿主机资源">
      <article className="metric-card"><div className="metric-label">可用内存 · MemAvailable</div><strong className="metric-value">{nullable(latest?.host.availableBytes)}</strong><footer>整机 {nullable(latest?.host.totalBytes)} · 含可回收缓存</footer></article>
      <article className="metric-card"><div className="metric-label">Swap 已使用</div><strong className="metric-value">{nullable(latest?.host.swapUsedBytes)}</strong><footer>换入 {nullable(latest?.host.swapInBytesPerSecond)} /s · 换出 {nullable(latest?.host.swapOutBytesPerSecond)} /s</footer></article>
      <article className="metric-card"><div className="metric-label">磁盘读写平均延迟 · 最大设备</div><strong className="metric-value">{nullable(awaitMs, (n) => `${n.toFixed(1)} ms`)}</strong><footer>最近采样 {latest ? dateTime(latest.at) : '—'}</footer></article>
    </section>
    <p className="resource-caption">当前数值来自最新采样；曲线与峰值来自所选时间段。{data ? `${data.sampleCount.toLocaleString()} 个样本 · ${data.bucketSeconds} 秒一个时间桶` : '读取记录中…'}。{data?.firstRecordedAt ? `记录始于 ${dateTime(data.firstRecordedAt)}。` : ''}</p>
    {data && points.length === 0 && <p className="resource-empty">此时段暂无采样记录</p>}
    {points.some((point) => point.gap) && <p className="form-error" role="status">所选时间段存在重启或采样断档，曲线已断开。</p>}
    <div className="resource-charts">
      <Trend title="可用内存" points={points} value={(p) => p.availableBytes} format={mib} />
      <div><label className="resource-container-select">容器工作集<select aria-label="查看容器曲线" value={container} onChange={(e) => setContainer(e.target.value)}>{[...new Set([container, ...names])].map((name) => <option key={name}>{name}</option>)}</select></label><Trend title={container} points={points} value={(p) => p.containers[container] ?? null} format={mib} /></div>
      <Trend title="Swap 换入与换出 · 最大速率" points={points} value={(p) => p.swapInBytesPerSecond === null && p.swapOutBytesPerSecond === null ? null : Math.max(p.swapInBytesPerSecond ?? 0, p.swapOutBytesPerSecond ?? 0)} format={(n) => `${mib(n)}/s`} />
      <Trend title="磁盘读写平均延迟" points={points} value={(p) => p.diskAwaitMs} format={(n) => `${n.toFixed(1)} ms`} />
    </div>
    <section className="resource-table" aria-label="各容器内存"><h2>内存去向</h2><p>工作集扣除可回收的非活跃文件缓存；总内存包含缓存。触限计数表示曾触发内存回收，不能单独判定 OOM。</p>
      <div className="resource-table__scroll"><table><thead><tr>{['容器', '当前工作集', '区间峰值', '当前总内存', 'RSS', '缓存', 'Swap', '内存上限', '触限计数'].map((name) => <th key={name}>{name}</th>)}</tr></thead>
        <tbody>{latest?.containers.map((c) => <tr key={c.id}><th>{c.name}</th><td>{mib(c.workingSetBytes)}</td><td>{names.includes(c.name) ? mib(peak(c.name)) : '—'}</td><td>{mib(c.usedBytes)}</td><td>{mib(c.rssBytes)}</td><td>{mib(c.cacheBytes)}</td><td>{mib(c.swapBytes)}</td><td>{c.limitBytes === null ? '未设置' : mib(c.limitBytes)}</td><td>{c.failCount.toLocaleString()}</td></tr>)}</tbody></table></div>
    </section>
    <section className="resource-table" aria-label="各磁盘延迟"><h2>磁盘状态</h2><div className="resource-table__scroll"><table><thead><tr><th>设备</th><th>读平均延迟</th><th>写平均延迟</th><th>繁忙比例</th></tr></thead><tbody>{latest?.disks.map((disk) => <tr key={disk.device}><th>{disk.device}</th><td>{nullable(disk.readAwaitMs, (n) => `${n.toFixed(2)} ms`)}</td><td>{nullable(disk.writeAwaitMs, (n) => `${n.toFixed(2)} ms`)}</td><td>{nullable(disk.busyPercent, (n) => `${n.toFixed(1)}%`)}</td></tr>)}</tbody></table></div></section>
  </div>
}
