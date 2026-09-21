import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import secureSession from '@fastify/secure-session'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'

import { AnalyticsRepository } from './analytics.js'
import { AutomationEngine } from './automation/engine.js'
import { AuthService } from './auth.js'
import { loadConfig, loadEnv } from './config.js'
import { PromptAuditRepository } from './prompt-audit/repository.js'
import { registerPromptCaptureRoute } from './prompt-audit/routes.js'
import { PromptAuditService } from './prompt-audit/service.js'
import { registerRoutes } from './routes.js'
import { StateStore } from './store.js'
import { Sub2ApiClient } from './sub2api-client.js'

const startedAt = new Date().toISOString()
const env = loadEnv()
const config = await loadConfig(env.CONFIG_PATH)
const store = new StateStore(env.STATE_PATH)
await store.initialize()

const client = new Sub2ApiClient(
  env.SUB2API_BASE_URL,
  env.SUB2API_ADMIN_API_KEY,
  config.resetSync.requestTimeoutSeconds * 1_000,
)
const engine = new AutomationEngine(config, client, store)
await engine.initialize()
const auth = new AuthService(client, store)
const analytics = new AnalyticsRepository({
  host: env.SUB2API_DB_HOST,
  port: env.SUB2API_DB_PORT,
  database: env.SUB2API_DB_NAME,
  user: env.SUB2API_DB_USER,
  password: env.SUB2API_DB_PASSWORD,
})
const promptAuditRepository = new PromptAuditRepository({
  host: env.SUB2API_DB_HOST,
  port: env.SUB2API_DB_PORT,
  database: env.SUB2API_DB_NAME,
  user: env.PROMPT_AUDIT_DB_USER,
  password: env.PROMPT_AUDIT_DB_PASSWORD,
  mediaPath: env.PROMPT_MEDIA_PATH,
  normalRetentionDays: config.promptAudit.normalRetentionDays,
  riskRetentionDays: config.promptAudit.riskRetentionDays,
})

const app = Fastify({
  logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
  trustProxy: true,
  bodyLimit: 256 * 1024,
})
const promptAudit = new PromptAuditService(promptAuditRepository, app.log)
await promptAudit.initialize()

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      frameSrc: ['https://challenges.cloudflare.com'],
      connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
    },
  },
})
await app.register(rateLimit, { global: false })
await app.register(secureSession, {
  key: Buffer.from(env.SESSION_KEY_BASE64, 'base64'),
  cookieName: 'sub2api_ops_session',
  expiry: 60 * 60 * 12,
  cookie: {
    path: env.COOKIE_PATH,
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
  },
})

registerPromptCaptureRoute(app, {
  captureSecret: env.PROMPT_CAPTURE_SECRET,
  maxRequestBodyBytes: () => engine.getConfig().promptAudit.maxRequestBodyMiB * 1024 * 1024,
  service: promptAudit,
})

app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith(`${env.COOKIE_PATH.replace(/\/$/, '')}/api`)) return
  reply.header('cache-control', 'no-store')
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return
  const origin = request.headers.origin
  if (env.NODE_ENV === 'production' && origin !== env.PUBLIC_ORIGIN) {
    await reply.code(403).send({ error: '请求来源无效' })
  }
})

await registerRoutes(app, { env, client, store, engine, auth, analytics, promptAuditRepository, startedAt })

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(currentDirectory, '../web')
await app.register(fastifyStatic, {
  root: webRoot,
  prefix: `${env.COOKIE_PATH.replace(/\/$/, '')}/`,
  decorateReply: true,
  index: false,
  wildcard: false,
})
app.get(env.COOKIE_PATH, async (_request, reply) => reply.redirect(`${env.COOKIE_PATH.replace(/\/$/, '')}/`))
app.get(`${env.COOKIE_PATH.replace(/\/$/, '')}/`, async (_request, reply) => reply.sendFile('index.html'))
app.get(`${env.COOKIE_PATH.replace(/\/$/, '')}/*`, async (request, reply) => {
  if (request.url.includes('/api/')) return reply.code(404).send({ error: '接口不存在' })
  return reply.sendFile('index.html')
})

app.addHook('onClose', async () => {
  engine.stop()
  await Promise.all([analytics.close(), promptAudit.close()])
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0))
  })
}

engine.start()
promptAudit.start()
await app.listen({ host: env.HOST, port: env.PORT })
