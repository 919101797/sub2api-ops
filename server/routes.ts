import { createReadStream } from 'node:fs'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { AccountRuntime, AnalyticsRange, DashboardResponse, JobKind, PromptAuditRange } from '../shared/contracts.js'
import { AnalyticsRepository } from './analytics.js'
import type { AnalyticsCycleWindow } from './analytics.js'
import { AutomationEngine } from './automation/engine.js'
import { AuthService } from './auth.js'
import { parseServiceConfig, saveConfig, type RuntimeEnv } from './config.js'
import { PromptAuditRepository } from './prompt-audit/repository.js'
import { Sub2ApiClient, Sub2ApiError } from './sub2api-client.js'
import { StateStore } from './store.js'

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  turnstileToken: z.string().min(1).optional(),
})

const twoFactorSchema = z.object({
  tempToken: z.string().min(1),
  totpCode: z.string().regex(/^\d{6}$/),
})

const oauthProviderSchema = z.object({ provider: z.enum(['github', 'google']) })
const oauthTokenSchema = z.object({
  provider: z.enum(['github', 'google']),
  accessToken: z.string().min(20).max(8_192),
  refreshToken: z.string().min(20).max(8_192).optional(),
  expiresIn: z.number().int().positive().max(31 * 24 * 60 * 60).optional(),
})

const oauthMarkerCookie = 'sub2api_ops_oauth'

function oauthMarker(provider: 'github' | 'google', secure: boolean, maxAge: number): string {
  return [
    `${oauthMarkerCookie}=${maxAge > 0 ? provider : ''}`,
    'Path=/auth/oauth/callback',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

const runSchema = z.object({ kind: z.enum(['reset', 'capacity']) })
const analyticsParamsSchema = z.object({ accountKey: z.string().regex(/^[a-z0-9-]+$/).max(80) })
const analyticsQuerySchema = z.object({
  range: z.enum(['day', 'week', 'month', 'cycle']).default('week'),
  cycleResetAt: z.coerce.number().int().positive().optional(),
}).superRefine((value, context) => {
  if (value.range === 'cycle' && value.cycleResetAt === undefined) {
    context.addIssue({ code: 'custom', path: ['cycleResetAt'], message: '请选择要统计的重置周期' })
  }
})
const promptRiskStatuses = ['pending', 'clear', 'flagged', 'error', 'not_required'] as const
const promptAuditStatusesSchema = z.string().default(promptRiskStatuses.join(',')).transform((value, context) => {
  const selected = [...new Set(value.split(',').filter(Boolean))]
  const invalid = selected.find((status) => !promptRiskStatuses.includes(status as typeof promptRiskStatuses[number]))
  if (invalid) {
    context.addIssue({ code: 'custom', message: `无效的审核状态：${invalid}` })
    return z.NEVER
  }
  return selected as Array<typeof promptRiskStatuses[number]>
})
const promptAuditQuerySchema = z.object({
  range: z.enum(['day', 'week', 'month']).default('day'),
  statuses: promptAuditStatusesSchema,
  userId: z.coerce.number().int().positive().optional(),
  groupId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(200).default(''),
  startAt: z.iso.datetime({ offset: true }).optional(),
  endAt: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(30),
}).superRefine((value, context) => {
  if (value.startAt && value.endAt && Date.parse(value.startAt) > Date.parse(value.endAt)) {
    context.addIssue({ code: 'custom', path: ['endAt'], message: '结束日期时间不能早于开始日期时间' })
  }
})
const promptAuditParamsSchema = z.object({ id: z.string().regex(/^(?:reviewed|captured):\d+$/) })
const promptAuditSessionParamsSchema = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
const promptAuditUserParamsSchema = z.object({ userId: z.coerce.number().int().positive() })
const promptAuditMediaParamsSchema = z.object({ mediaId: z.coerce.number().int().positive() })
const promptAuditPurgeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all') }),
  z.object({ scope: z.literal('before'), before: z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) <= Date.now(), '清理日期时间不能晚于现在') }),
])

const RESET_CYCLE_MATCH_TOLERANCE_SECONDS = 3_600
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60

function analyticsCycle(account: AccountRuntime | undefined, requestedResetAt: number): AnalyticsCycleWindow | null {
  if (!account) return null
  const saved = account.reset.cycles ?? []
  const savedCycle = saved.find((cycle) => Math.abs(cycle.resetAt - requestedResetAt) <= RESET_CYCLE_MATCH_TOLERANCE_SECONDS)
  if (savedCycle) {
    return {
      resetAt: savedCycle.resetAt,
      startAt: savedCycle.startAt ?? savedCycle.resetAt - SEVEN_DAYS_SECONDS,
      status: savedCycle.status,
    }
  }

  const observation = account.reset.pendingEvent?.observation ?? account.reset.observation
    ?? (account.capacity ? { resetAt: account.capacity.resetAt } : undefined)
  if (!observation) return null
  const inferredIndex = Math.round((observation.resetAt - requestedResetAt) / SEVEN_DAYS_SECONDS)
  if (inferredIndex < 0 || inferredIndex > 3 || Math.abs(observation.resetAt - requestedResetAt - inferredIndex * SEVEN_DAYS_SECONDS) > RESET_CYCLE_MATCH_TOLERANCE_SECONDS) return null
  return {
    resetAt: inferredIndex === 0 ? observation.resetAt : requestedResetAt,
    startAt: (inferredIndex === 0 ? observation.resetAt : requestedResetAt) - SEVEN_DAYS_SECONDS,
    status: inferredIndex === 0 ? 'current' : 'completed',
  }
}

function errorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof z.ZodError) return { status: 400, message: error.issues[0]?.message ?? '请求数据无效' }
  if (error instanceof Sub2ApiError) return { status: Math.min(Math.max(error.status, 400), 599), message: error.message }
  if (error instanceof SyntaxError) return { status: 400, message: '请求数据格式无效' }
  return { status: 500, message: error instanceof Error ? error.message : '未知错误' }
}

async function handle<T>(reply: FastifyReply, task: () => Promise<T>): Promise<void> {
  try {
    await reply.send(await task())
  } catch (error) {
    const response = errorResponse(error)
    if (response.status >= 500) reply.log.error({ err: error }, response.message)
    await reply.code(response.status).send({ error: response.message })
  }
}

export async function registerRoutes(
  app: FastifyInstance,
  dependencies: {
    env: RuntimeEnv
    client: Sub2ApiClient
    store: StateStore
    engine: AutomationEngine
    auth: AuthService
    analytics: AnalyticsRepository
    promptAuditRepository: PromptAuditRepository
    startedAt: string
  },
): Promise<void> {
  const { env, client, store, engine, auth, analytics, promptAuditRepository, startedAt } = dependencies
  const apiPrefix = `${env.COOKIE_PATH.replace(/\/$/, '')}/api`
  const infrastructureCache: { key: string; value: DashboardResponse['infrastructure']; refreshedAt: number; pending: Promise<void> | null } = {
    key: '',
    value: [],
    refreshedAt: 0,
    pending: null,
  }

  const refreshInfrastructure = (accounts: DashboardResponse['config']['accounts']): void => {
    const key = accounts.map((account) => `${account.key}:${account.email}`).join('|')
    if (key !== infrastructureCache.key) {
      infrastructureCache.key = key
      infrastructureCache.value = []
      infrastructureCache.refreshedAt = 0
    }
    if (infrastructureCache.pending || Date.now() - infrastructureCache.refreshedAt < 60_000) return
    const requestKey = key
    infrastructureCache.pending = client.accountInfrastructure(accounts)
      .then((value) => {
        if (infrastructureCache.key !== requestKey) return
        infrastructureCache.value = value
        infrastructureCache.refreshedAt = Date.now()
      })
      .catch((error: unknown) => {
        if (infrastructureCache.key !== requestKey) return
        app.log.warn({ err: error }, '无法读取 OpenAI 账号家宽关联')
        infrastructureCache.value = accounts.map((account) => ({
          accountKey: account.key,
          email: account.email,
          proxy: null,
          error: '暂时无法读取家宽信息',
        }))
        infrastructureCache.refreshedAt = Date.now()
      })
      .finally(() => {
        infrastructureCache.pending = null
      })
  }

  const dashboardResponse = async (): Promise<DashboardResponse> => {
    const state = store.snapshot()
    const jobs = Object.values(state.jobs)
    const config = engine.getConfig()
    refreshInfrastructure(config.accounts)
    return {
      generatedAt: new Date().toISOString(),
      service: {
        health: jobs.some((job) => job.health === 'degraded') ? 'degraded' : 'healthy',
        version: '2.12.1',
        startedAt,
      },
      config,
      accounts: Object.values(state.accounts),
      infrastructure: infrastructureCache.value,
      jobs,
      events: state.events,
    }
  }

  app.get('/health', async (_request, reply) => {
    const jobs = Object.values(store.snapshot().jobs)
    const healthy = jobs.every((job) => job.health !== 'degraded')
    await reply.code(healthy ? 200 : 503).send({ status: healthy ? 'healthy' : 'degraded', jobs })
  })

  app.get(`${apiPrefix}/auth/config`, async (_request, reply) => {
    await handle(reply, async () => {
      const settings = await client.publicSettings()
      return {
        siteName: settings.site_name,
        turnstileEnabled: settings.turnstile_enabled,
        turnstileSiteKey: settings.turnstile_site_key,
        githubOAuthEnabled: settings.github_oauth_enabled,
        googleOAuthEnabled: settings.google_oauth_enabled,
      }
    })
  })

  app.get(`${apiPrefix}/auth/oauth/:provider/start`, async (request, reply) => {
    try {
      const { provider } = oauthProviderSchema.parse(request.params)
      const settings = await client.publicSettings()
      const enabled = provider === 'github' ? settings.github_oauth_enabled : settings.google_oauth_enabled
      if (!enabled) throw new Sub2ApiError(`${provider === 'github' ? 'GitHub' : 'Google'} 登录未启用`, 404)
      reply.header('set-cookie', oauthMarker(provider, env.COOKIE_SECURE, 10 * 60))
      await reply.redirect(client.oauthStartPath(provider))
    } catch (error) {
      const response = errorResponse(error)
      await reply.code(response.status).send({ error: response.message })
    }
  })

  app.get('/auth/oauth/callback', async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    reply.header('set-cookie', oauthMarker('github', env.COOKIE_SECURE, 0))
    await reply.redirect(`${env.COOKIE_PATH.replace(/\/$/, '')}/auth/callback`)
  })

  app.post(`${apiPrefix}/auth/login`, {
    config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    await handle(reply, () => {
      const input = loginSchema.parse(request.body)
      return auth.login(request, {
        email: input.email,
        password: input.password,
        ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}),
      })
    })
  })

  app.post(`${apiPrefix}/auth/2fa`, {
    config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    await handle(reply, () => auth.login2fa(request, twoFactorSchema.parse(request.body)))
  })

  app.post(`${apiPrefix}/auth/oauth`, {
    config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    await handle(reply, () => {
      const input = oauthTokenSchema.parse(request.body)
      return auth.loginOAuth(request, {
        provider: input.provider,
        accessToken: input.accessToken,
        ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
        ...(input.expiresIn ? { expiresIn: input.expiresIn } : {}),
      })
    })
  })

  const protectedRoute = async (request: FastifyRequest, reply: FastifyReply) => auth.requireAdmin(request, reply)

  app.get(`${apiPrefix}/bootstrap`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => ({
      user: auth.sessionUser(request),
      // The optional upstream proxy lookup runs in the background and is
      // supplied by the next dashboard refresh, so authentication is instant.
      dashboard: await dashboardResponse(),
    }))
  })

  app.post(`${apiPrefix}/auth/logout`, { preHandler: protectedRoute }, async (request, reply) => {
    await auth.logout(request)
    await reply.send({ ok: true })
  })

  app.get(`${apiPrefix}/dashboard`, { preHandler: protectedRoute }, async (_request, reply) => {
    await handle(reply, dashboardResponse)
  })

  app.get(`${apiPrefix}/settings/options`, { preHandler: protectedRoute }, async (_request, reply) => {
    await handle(reply, () => client.settingsOptions())
  })

  app.get(`${apiPrefix}/accounts/:accountKey/analytics`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => {
      const { accountKey } = analyticsParamsSchema.parse(request.params)
      const query = analyticsQuerySchema.parse(request.query)
      const configured = engine.getConfig().accounts.find((account) => account.key === accountKey)
      if (!configured) throw new Sub2ApiError('该账号不在当前运维配置中', 404)
      const account = await client.resolveOpenAIAccount(configured.email)
      const runtime = store.snapshot().accounts[accountKey]
      const cycle = query.range === 'cycle'
        ? analyticsCycle(runtime, query.cycleResetAt!)
        : undefined
      if (query.range === 'cycle' && !cycle) {
        throw new Sub2ApiError('该重置周期尚未被运维服务采集', 400)
      }
      return analytics.accountAnalytics({
        accountKey,
        accountId: account.id,
        groupIds: configured.targetGroupIds,
        range: query.range as AnalyticsRange,
        ...(cycle ? { cycle } : {}),
      })
    })
  })

  app.get(`${apiPrefix}/prompts`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => {
      const query = promptAuditQuerySchema.parse(request.query)
      return promptAuditRepository.list({
        range: query.range as PromptAuditRange,
        statuses: query.statuses,
        userId: query.userId ?? null,
        groupId: query.groupId ?? null,
        search: query.search,
        startAt: query.startAt ? new Date(query.startAt) : null,
        endAt: query.endAt ? new Date(query.endAt) : null,
        page: query.page,
        pageSize: query.pageSize,
      })
    })
  })

  app.get(`${apiPrefix}/prompts/filter-options`, { preHandler: protectedRoute }, async (_request, reply) => {
    await handle(reply, () => client.promptAuditFilterOptions())
  })

  app.get(`${apiPrefix}/prompts/storage`, { preHandler: protectedRoute }, async (_request, reply) => {
    await handle(reply, () => promptAuditRepository.storage())
  })

  app.post(`${apiPrefix}/prompts/purge`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => {
      const input = promptAuditPurgeSchema.parse(request.body)
      const before = input.scope === 'all' ? new Date() : new Date(input.before)
      const result = await promptAuditRepository.purge(before)
      const user = auth.sessionUser(request)
      await store.addEvent({
        severity: 'warning',
        category: 'prompt_audit',
        summary: input.scope === 'all' ? `管理员 ${user.email} 已清空提示词审计数据` : `管理员 ${user.email} 已删除指定日期前的提示词审计数据`,
        details: {
          scope: input.scope,
          before: result.before,
          deletedRecords: result.deletedRecords,
          deletedImages: result.deletedImages,
          freedImageBytes: result.freedImageBytes,
        },
      })
      return result
    })
  })

  app.get(`${apiPrefix}/prompts/media/:mediaId`, { preHandler: protectedRoute }, async (request, reply) => {
    try {
      const { mediaId } = promptAuditMediaParamsSchema.parse(request.params)
      const media = await promptAuditRepository.mediaFile(mediaId)
      if (!media) throw new Sub2ApiError('该图片不存在或已过期', 404)
      reply.header('content-type', media.mimeType)
      reply.header('content-length', String(media.byteSize))
      reply.header('content-disposition', `inline; filename="${media.fileName}"`)
      reply.header('cache-control', 'private, max-age=300')
      await reply.send(createReadStream(media.path))
    } catch (error) {
      const response = errorResponse(error)
      await reply.code(response.status).send({ error: response.message })
    }
  })

  app.get(`${apiPrefix}/prompts/sessions/:fingerprint`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => {
      const { fingerprint } = promptAuditSessionParamsSchema.parse(request.params)
      const session = await promptAuditRepository.session(fingerprint)
      if (!session) throw new Sub2ApiError('该会话不存在或记录已过期', 404)
      return session
    })
  })

  app.get(`${apiPrefix}/prompts/:id`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => {
      const { id } = promptAuditParamsSchema.parse(request.params)
      const record = await promptAuditRepository.detail(id)
      if (!record) throw new Sub2ApiError('该审计记录不存在或已过期', 404)
      return record
    })
  })

  app.post(`${apiPrefix}/prompts/users/:userId/unban`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => {
      const { userId } = promptAuditUserParamsSchema.parse(request.params)
      await client.unbanRiskControlledUser(userId)
      return { ok: true, userId }
    })
  })

  app.post(`${apiPrefix}/run`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => {
      const { kind } = runSchema.parse(request.body)
      void engine.run(kind as JobKind, true).catch((error) => request.log.error({ err: error }, 'manual job failed'))
      return { accepted: true, kind }
    })
  })

  app.put(`${apiPrefix}/config`, { preHandler: protectedRoute }, async (request, reply) => {
    await handle(reply, async () => {
      const config = parseServiceConfig(request.body)
      await saveConfig(env.CONFIG_PATH, config)
      await promptAuditRepository.configureRetention(
        config.promptAudit.normalRetentionDays,
        config.promptAudit.riskRetentionDays,
      )
      await engine.replaceConfig(config)
      await store.addEvent({
        severity: 'success',
        category: 'configuration',
        summary: '运维自动化配置已更新',
        details: {
          accounts: config.accounts.map((account) => account.email),
          promptAuditRetention: config.promptAudit,
          userConcurrencySchedule: config.userConcurrencySchedule,
        },
      })
      return config
    })
  })
}
