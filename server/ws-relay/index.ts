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
const relay = await createWsAuditRelay(config, logger)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void relay.close().finally(() => process.exit(0))
  })
}

await relay.listen()
logger.info({ host: config.WS_RELAY_HOST, port: config.WS_RELAY_PORT }, 'WS 审计 Relay 已启动')
