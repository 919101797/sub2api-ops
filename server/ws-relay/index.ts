import { Pool } from 'pg'
import { loadEnv } from '../config.js'
import { RequestGuard } from '../request-limits/guard.js'
import { RequestLimitsStore } from '../request-limits/policy.js'
import { loadWsRelayConfig } from './config.js'
import { createWsAuditRelay } from './server.js'

function write(level: 'error' | 'info' | 'warn', values: Record<string, unknown>, message: string): void {
  const output = JSON.stringify({ level, time: new Date().toISOString(), message, ...values })
  if (level === 'error') console.error(output)
  else if (level === 'warn') console.warn(output)
  else console.info(output)
}

const logger = {
  error: (values: Record<string, unknown>, message: string) => write('error', values, message),
  info: (values: Record<string, unknown>, message: string) => write('info', values, message),
  warn: (values: Record<string, unknown>, message: string) => write('warn', values, message),
}

const config = loadWsRelayConfig()
const env = loadEnv()
const pool = new Pool({ host: env.SUB2API_DB_HOST, port: env.SUB2API_DB_PORT, database: env.SUB2API_DB_NAME,
  user: env.PROMPT_AUDIT_DB_USER, password: env.PROMPT_AUDIT_DB_PASSWORD,
  max: 2, connectionTimeoutMillis: 1500, query_timeout: 1500, statement_timeout: 1500, idleTimeoutMillis: 10000,
})
pool.on('error', () => logger.error({}, '用户身份数据库连接异常'))
const store = new RequestLimitsStore(config.REQUEST_LIMITS_PATH)
await store.read()
const guard = new RequestGuard(store, async key => {
  const result = await pool.query<{ user_id: string }>('SELECT user_id FROM sub2api_ops.resolve_api_key($1)', [key])
  return result.rows[0] ? Number(result.rows[0].user_id) : null
})
const relay = await createWsAuditRelay(config, logger, guard)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void relay.close().then(() => pool.end()).finally(() => process.exit(0))
  })
}

await relay.listen()
logger.info({ host: config.WS_RELAY_HOST, port: config.WS_RELAY_PORT }, 'WS 审计 Relay 已启动')
