export function currency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)}%`
}

export function dateTime(value: string | number | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value * 1_000) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '尚未运行'
  const delta = new Date(value).getTime() - Date.now()
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
  const minutes = Math.round(delta / 60_000)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(delta / 3_600_000)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(delta / 86_400_000), 'day')
}

export function fileSize(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '—'
  if (value < 1_024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1_024
  let unit = units[0]!
  for (let index = 1; index < units.length && size >= 1_024; index += 1) {
    size /= 1_024
    unit = units[index]!
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${unit}`
}
