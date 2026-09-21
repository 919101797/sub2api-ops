import chineseDays from 'chinese-days'

export type ConcurrencySchedulePeriod = 'peak' | 'idle' | 'weekend' | 'holiday'

export interface ConcurrencyScheduleTarget {
  concurrency: number
  rpmLimit: number
  period: ConcurrencySchedulePeriod
}

export interface ConcurrencyScheduleConfig {
  timezone: string
  peakWindows: Array<{
    start: string
    end: string
  }>
  peakConcurrency: number
  idleConcurrency: number
  peakRpm: number
  idleRpm: number
}

interface LocalDateTime {
  date: string
  weekday: string
  minutes: number
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()

function localDateTime(at: Date, timezone: string): LocalDateTime {
  let formatter = dateTimeFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    dateTimeFormatters.set(timezone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]))
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday ?? '',
    minutes: hour * 60 + minute,
  }
}

export function concurrencyScheduleTarget(
  at: Date,
  schedule: ConcurrencyScheduleConfig,
): ConcurrencyScheduleTarget {
  const local = localDateTime(at, schedule.timezone)
  if (local.weekday === 'Sat' || local.weekday === 'Sun') {
    return { concurrency: schedule.idleConcurrency, rpmLimit: schedule.idleRpm, period: 'weekend' }
  }
  if (chineseDays.isHoliday(local.date)) {
    return { concurrency: schedule.idleConcurrency, rpmLimit: schedule.idleRpm, period: 'holiday' }
  }

  const toMinutes = (value: string) => {
    const [hour = '0', minute = '0'] = value.split(':')
    return Number(hour) * 60 + Number(minute)
  }
  const peak = schedule.peakWindows.some((window) => (
    local.minutes >= toMinutes(window.start) && local.minutes < toMinutes(window.end)
  ))
  return peak
    ? { concurrency: schedule.peakConcurrency, rpmLimit: schedule.peakRpm, period: 'peak' }
    : { concurrency: schedule.idleConcurrency, rpmLimit: schedule.idleRpm, period: 'idle' }
}
