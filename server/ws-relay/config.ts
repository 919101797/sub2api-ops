import { z } from 'zod'

const relayEnvSchema = z.object({
  WS_RELAY_HOST: z.string().default('0.0.0.0'),
  WS_RELAY_PORT: z.coerce.number().int().positive().max(65_535).default(8090),
  WS_RELAY_UPSTREAM_ORIGIN: z.url(),
  WS_AUDIT_CAPTURE_URL: z.url(),
  WS_AUDIT_OUTBOX_PATH: z.string().min(1).default('/data/outbox'),
  WS_AUDIT_OUTBOX_MAX_BYTES: z.coerce.number().int().min(16 * 1024 * 1024).max(16 * 1024 * 1024 * 1024).default(512 * 1024 * 1024),
  WS_RELAY_MAX_MESSAGE_BYTES: z.coerce.number().int().min(1_024).max(64 * 1024 * 1024).default(16 * 1024 * 1024),
  PROMPT_CAPTURE_SECRET: z.string().min(32),
})

export type WsRelayConfig = z.infer<typeof relayEnvSchema>

export function loadWsRelayConfig(source: NodeJS.ProcessEnv = process.env): WsRelayConfig {
  const config = relayEnvSchema.parse(source)
  const upstream = new URL(config.WS_RELAY_UPSTREAM_ORIGIN)
  if (!['ws:', 'wss:'].includes(upstream.protocol) || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('WS_RELAY_UPSTREAM_ORIGIN must be a ws:// or wss:// origin without a path')
  }
  const capture = new URL(config.WS_AUDIT_CAPTURE_URL)
  if (!['http:', 'https:'].includes(capture.protocol)) {
    throw new Error('WS_AUDIT_CAPTURE_URL must use http:// or https://')
  }
  return config
}
