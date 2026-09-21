import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'

import { z } from 'zod'

import type { ServiceConfig } from '../shared/contracts.js'

const accountSchema = z.object({
  key: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
  email: z.email(),
  label: z.string().trim().min(1).max(120),
  share_count: z.number().int().min(1).max(100),
  reserve_mode: z.enum(['usd', 'percent']),
  reserve_value: z.number().min(0).max(1_000_000),
  target_group_ids: z.array(z.number().int().positive()).min(1),
  enabled: z.boolean(),
}).refine((account) => account.reserve_mode !== 'percent' || account.reserve_value <= 100, {
  message: '预留百分比不能大于 100',
  path: ['reserve_value'],
})

const exemptUserIdsSchema = z.array(z.number().int().positive()).max(10_000).refine(
  (ids) => new Set(ids).size === ids.length,
  'Duplicate user exemption ID',
)

const concurrencyLimitSchema = z.number().int().min(1).max(100)
const rpmLimitSchema = z.number().int().min(1).max(10_000)
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '时间必须使用 HH:mm 格式')
const peakWindowSchema = z.object({ start: timeSchema, end: timeSchema })
const peakWindowsSchema = z.array(peakWindowSchema).min(1).max(4).superRefine((windows, context) => {
  const toMinutes = (value: string) => {
    const [hour = '0', minute = '0'] = value.split(':')
    return Number(hour) * 60 + Number(minute)
  }
  const ranges = windows.map((window, index) => ({
    index,
    start: toMinutes(window.start),
    end: toMinutes(window.end),
  }))
  for (const range of ranges) {
    if (range.start >= range.end) {
      context.addIssue({
        code: 'custom',
        message: '高峰时段的开始时间必须早于结束时间',
        path: [range.index, 'end'],
      })
    }
  }
  for (let leftIndex = 0; leftIndex < ranges.length; leftIndex += 1) {
    const left = ranges[leftIndex]
    if (!left || left.start >= left.end) continue
    for (let rightIndex = leftIndex + 1; rightIndex < ranges.length; rightIndex += 1) {
      const right = ranges[rightIndex]
      if (!right || right.start >= right.end) continue
      if (left.start < right.end && right.start < left.end) {
        context.addIssue({
          code: 'custom',
          message: '高峰时段不能重叠',
          path: [right.index, 'start'],
        })
      }
    }
  }
})
const timezoneSchema = z.string().trim().min(1).refine((timezone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}, '无效的 IANA 时区')

const rawConcurrencyScheduleSchema = z.object({
  enabled: z.boolean(),
  timezone: timezoneSchema,
  peak_windows: peakWindowsSchema,
  peak_concurrency: concurrencyLimitSchema,
  idle_concurrency: concurrencyLimitSchema,
  peak_rpm: rpmLimitSchema,
  idle_rpm: rpmLimitSchema,
  exempt_user_ids: exemptUserIdsSchema,
}).refine((value) => value.peak_concurrency <= value.idle_concurrency, {
  message: '高峰并发不能大于闲时并发',
  path: ['peak_concurrency'],
}).refine((value) => value.peak_rpm <= value.idle_rpm, {
  message: '高峰 RPM 不能大于闲时 RPM',
  path: ['peak_rpm'],
})

const serviceConcurrencyScheduleSchema = z.object({
  enabled: z.boolean(),
  timezone: timezoneSchema,
  peakWindows: peakWindowsSchema,
  peakConcurrency: concurrencyLimitSchema,
  idleConcurrency: concurrencyLimitSchema,
  peakRpm: rpmLimitSchema,
  idleRpm: rpmLimitSchema,
  exemptUserIds: exemptUserIdsSchema,
}).refine((value) => value.peakConcurrency <= value.idleConcurrency, {
  message: '高峰并发不能大于闲时并发',
  path: ['peakConcurrency'],
}).refine((value) => value.peakRpm <= value.idleRpm, {
  message: '高峰 RPM 不能大于闲时 RPM',
  path: ['peakRpm'],
})

export const rawConfigSchema = z
  .object({
    version: z.literal(11),
    fixed_group_ids: z.array(z.number().int().positive()),
    reset_sync: z.object({
      interval_seconds: z.number().int().min(30).max(86_400),
      request_timeout_seconds: z.number().int().min(1).max(120),
      reset_at_tolerance_seconds: z.number().int().min(0).max(3_600),
      usage_drop_tolerance_percent: z.number().min(0).max(100),
    }),
    capacity_sync: z.object({
      interval_seconds: z.number().int().min(60).max(86_400),
      minimum_used_percent: z.number().min(0.1).max(100),
      minimum_change_usd: z.number().min(0).max(10_000),
    }),
    prompt_audit: z.object({
      max_request_body_mib: z.number().int().min(1).max(16),
      normal_retention_days: z.number().int().min(1).max(365),
      risk_retention_days: z.number().int().min(1).max(3_650),
    }),
    user_concurrency_schedule: rawConcurrencyScheduleSchema,
    accounts: z.array(accountSchema).min(1),
  })
  .superRefine((config, context) => {
    if (config.prompt_audit.risk_retention_days < config.prompt_audit.normal_retention_days) {
      context.addIssue({
        code: 'custom',
        message: 'Risk retention must not be shorter than normal retention',
        path: ['prompt_audit', 'risk_retention_days'],
      })
    }
    const keys = new Set<string>()
    const emails = new Set<string>()
    const claimedGroups = new Map<number, string>()
    const fixed = new Set(config.fixed_group_ids)

    for (const [index, account] of config.accounts.entries()) {
      if (keys.has(account.key)) {
        context.addIssue({ code: 'custom', message: `Duplicate account key: ${account.key}`, path: ['accounts', index, 'key'] })
      }
      keys.add(account.key)

      const email = account.email.toLowerCase()
      if (emails.has(email)) {
        context.addIssue({ code: 'custom', message: `Duplicate account email: ${account.email}`, path: ['accounts', index, 'email'] })
      }
      emails.add(email)

      for (const groupId of account.target_group_ids) {
        if (fixed.has(groupId)) {
          context.addIssue({ code: 'custom', message: `Group ${groupId} is fixed and cannot be a sync target`, path: ['accounts', index, 'target_group_ids'] })
        }
        const owner = claimedGroups.get(groupId)
        if (owner) {
          context.addIssue({ code: 'custom', message: `Group ${groupId} is already assigned to ${owner}`, path: ['accounts', index, 'target_group_ids'] })
        }
        claimedGroups.set(groupId, account.key)
      }
    }
  })

export type RawConfig = z.infer<typeof rawConfigSchema>

const serviceConfigSchema = z.object({
  version: z.literal(11),
  fixedGroupIds: z.array(z.number().int().positive()),
  resetSync: z.object({
    intervalSeconds: z.number().int().min(30).max(86_400),
    requestTimeoutSeconds: z.number().int().min(1).max(120),
    resetAtToleranceSeconds: z.number().int().min(0).max(3_600),
    usageDropTolerancePercent: z.number().min(0).max(100),
  }),
  capacitySync: z.object({
    intervalSeconds: z.number().int().min(60).max(86_400),
    minimumUsedPercent: z.number().min(0.1).max(100),
    minimumChangeUsd: z.number().min(0).max(10_000),
  }),
  promptAudit: z.object({
    maxRequestBodyMiB: z.number().int().min(1).max(16),
    normalRetentionDays: z.number().int().min(1).max(365),
    riskRetentionDays: z.number().int().min(1).max(3_650),
  }).refine((value) => value.riskRetentionDays >= value.normalRetentionDays, {
    message: '风险记录保留时间不能短于正常记录',
    path: ['riskRetentionDays'],
  }),
  userConcurrencySchedule: serviceConcurrencyScheduleSchema,
  accounts: z.array(z.object({
    key: z.string(),
    email: z.string(),
    label: z.string(),
    shareCount: z.number(),
    reserveMode: z.enum(['usd', 'percent']),
    reserveValue: z.number().min(0).max(1_000_000),
    targetGroupIds: z.array(z.number()),
    enabled: z.boolean(),
  }).refine((account) => account.reserveMode !== 'percent' || account.reserveValue <= 100, {
    message: '预留百分比不能大于 100',
    path: ['reserveValue'],
  })).min(1),
})

export function fromRawConfig(raw: RawConfig): ServiceConfig {
  return {
    version: 11,
    fixedGroupIds: raw.fixed_group_ids,
    resetSync: {
      intervalSeconds: raw.reset_sync.interval_seconds,
      requestTimeoutSeconds: raw.reset_sync.request_timeout_seconds,
      resetAtToleranceSeconds: raw.reset_sync.reset_at_tolerance_seconds,
      usageDropTolerancePercent: raw.reset_sync.usage_drop_tolerance_percent,
    },
    capacitySync: {
      intervalSeconds: raw.capacity_sync.interval_seconds,
      minimumUsedPercent: raw.capacity_sync.minimum_used_percent,
      minimumChangeUsd: raw.capacity_sync.minimum_change_usd,
    },
    promptAudit: {
      maxRequestBodyMiB: raw.prompt_audit.max_request_body_mib,
      normalRetentionDays: raw.prompt_audit.normal_retention_days,
      riskRetentionDays: raw.prompt_audit.risk_retention_days,
    },
    userConcurrencySchedule: {
      enabled: raw.user_concurrency_schedule.enabled,
      timezone: raw.user_concurrency_schedule.timezone,
      peakWindows: raw.user_concurrency_schedule.peak_windows,
      peakConcurrency: raw.user_concurrency_schedule.peak_concurrency,
      idleConcurrency: raw.user_concurrency_schedule.idle_concurrency,
      peakRpm: raw.user_concurrency_schedule.peak_rpm,
      idleRpm: raw.user_concurrency_schedule.idle_rpm,
      exemptUserIds: raw.user_concurrency_schedule.exempt_user_ids,
    },
    accounts: raw.accounts.map((account) => ({
      key: account.key,
      email: account.email.toLowerCase(),
      label: account.label,
      shareCount: account.share_count,
      reserveMode: account.reserve_mode,
      reserveValue: account.reserve_value,
      targetGroupIds: account.target_group_ids,
      enabled: account.enabled,
    })),
  }
}

export function toRawConfig(config: ServiceConfig): RawConfig {
  return rawConfigSchema.parse({
    version: 11,
    fixed_group_ids: config.fixedGroupIds,
    reset_sync: {
      interval_seconds: config.resetSync.intervalSeconds,
      request_timeout_seconds: config.resetSync.requestTimeoutSeconds,
      reset_at_tolerance_seconds: config.resetSync.resetAtToleranceSeconds,
      usage_drop_tolerance_percent: config.resetSync.usageDropTolerancePercent,
    },
    capacity_sync: {
      interval_seconds: config.capacitySync.intervalSeconds,
      minimum_used_percent: config.capacitySync.minimumUsedPercent,
      minimum_change_usd: config.capacitySync.minimumChangeUsd,
    },
    prompt_audit: {
      max_request_body_mib: config.promptAudit.maxRequestBodyMiB,
      normal_retention_days: config.promptAudit.normalRetentionDays,
      risk_retention_days: config.promptAudit.riskRetentionDays,
    },
    user_concurrency_schedule: {
      enabled: config.userConcurrencySchedule.enabled,
      timezone: config.userConcurrencySchedule.timezone,
      peak_windows: config.userConcurrencySchedule.peakWindows,
      peak_concurrency: config.userConcurrencySchedule.peakConcurrency,
      idle_concurrency: config.userConcurrencySchedule.idleConcurrency,
      peak_rpm: config.userConcurrencySchedule.peakRpm,
      idle_rpm: config.userConcurrencySchedule.idleRpm,
      exempt_user_ids: config.userConcurrencySchedule.exemptUserIds,
    },
    accounts: config.accounts.map((account) => ({
      key: account.key,
      email: account.email,
      label: account.label,
      share_count: account.shareCount,
      reserve_mode: account.reserveMode,
      reserve_value: account.reserveValue,
      target_group_ids: account.targetGroupIds,
      enabled: account.enabled,
    })),
  })
}

export function parseServiceConfig(input: unknown): ServiceConfig {
  const candidate = serviceConfigSchema.parse(input)
  return fromRawConfig(rawConfigSchema.parse({
    version: candidate.version,
    fixed_group_ids: candidate.fixedGroupIds,
    reset_sync: {
      interval_seconds: candidate.resetSync.intervalSeconds,
      request_timeout_seconds: candidate.resetSync.requestTimeoutSeconds,
      reset_at_tolerance_seconds: candidate.resetSync.resetAtToleranceSeconds,
      usage_drop_tolerance_percent: candidate.resetSync.usageDropTolerancePercent,
    },
    capacity_sync: {
      interval_seconds: candidate.capacitySync.intervalSeconds,
      minimum_used_percent: candidate.capacitySync.minimumUsedPercent,
      minimum_change_usd: candidate.capacitySync.minimumChangeUsd,
    },
    prompt_audit: {
      max_request_body_mib: candidate.promptAudit.maxRequestBodyMiB,
      normal_retention_days: candidate.promptAudit.normalRetentionDays,
      risk_retention_days: candidate.promptAudit.riskRetentionDays,
    },
    user_concurrency_schedule: {
      enabled: candidate.userConcurrencySchedule.enabled,
      timezone: candidate.userConcurrencySchedule.timezone,
      peak_windows: candidate.userConcurrencySchedule.peakWindows,
      peak_concurrency: candidate.userConcurrencySchedule.peakConcurrency,
      idle_concurrency: candidate.userConcurrencySchedule.idleConcurrency,
      peak_rpm: candidate.userConcurrencySchedule.peakRpm,
      idle_rpm: candidate.userConcurrencySchedule.idleRpm,
      exempt_user_ids: candidate.userConcurrencySchedule.exemptUserIds,
    },
    accounts: candidate.accounts.map((account) => ({
      key: account.key,
      email: account.email,
      label: account.label,
      share_count: account.shareCount,
      reserve_mode: account.reserveMode,
      reserve_value: account.reserveValue,
      target_group_ids: account.targetGroupIds,
      enabled: account.enabled,
    })),
  }))
}

export async function loadConfig(path: string): Promise<ServiceConfig> {
  const text = await readFile(path, 'utf8')
  return fromRawConfig(rawConfigSchema.parse(JSON.parse(text)))
}

export async function saveConfig(path: string, config: ServiceConfig): Promise<void> {
  const raw = toRawConfig(config)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8080),
  CONFIG_PATH: z.string().default('./config.json'),
  STATE_PATH: z.string().default('./data/state.json'),
  SUB2API_BASE_URL: z.url().default('http://sub2api:8080/api/v1'),
  SUB2API_ADMIN_API_KEY: z.string().min(1),
  SUB2API_DB_HOST: z.string().min(1),
  SUB2API_DB_PORT: z.coerce.number().int().positive().default(5432),
  SUB2API_DB_NAME: z.string().min(1),
  SUB2API_DB_USER: z.string().min(1),
  SUB2API_DB_PASSWORD: z.string().min(1),
  PROMPT_AUDIT_DB_USER: z.string().min(1),
  PROMPT_AUDIT_DB_PASSWORD: z.string().min(1),
  PROMPT_CAPTURE_SECRET: z.string().min(32),
  PROMPT_MEDIA_PATH: z.string().min(1).default('/data/prompt-media'),
  SESSION_KEY_BASE64: z.string().min(1),
  PUBLIC_ORIGIN: z.url(),
  COOKIE_PATH: z.string().default('/ops'),
  COOKIE_SECURE: z.stringbool().default(false),
})

export type RuntimeEnv = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const env = envSchema.parse(source)
  const key = Buffer.from(env.SESSION_KEY_BASE64, 'base64')
  if (key.length !== 32) {
    throw new Error('SESSION_KEY_BASE64 must decode to exactly 32 bytes')
  }
  return env
}
