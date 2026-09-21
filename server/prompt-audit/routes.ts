import { createHash, timingSafeEqual } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { extractPromptSessionIdentity, parsePrompt, parseWebSocketPrompt, type PromptSessionIdentity } from './parser.js'
import type { PromptAuditService } from './service.js'

export const PROMPT_CAPTURE_CONTENT_TYPE = 'application/x-sub2api-prompt-capture'
export const PROMPT_WS_CAPTURE_CONTENT_TYPE = 'application/x-sub2api-ws-capture'
export const PROMPT_CAPTURE_BODY_LIMIT = 16 * 1024 * 1024

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function normalizedRequestId(value: string | string[] | undefined): string | null {
  const requestId = Array.isArray(value) ? value[0] : value
  if (!requestId || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) return null
  return requestId
}

function apiKeyFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const authorizationValue = headers['x-original-authorization']
  const apiKeyValue = headers['x-original-api-key']
  const authorization = Array.isArray(authorizationValue) ? authorizationValue[0] : authorizationValue
  const direct = Array.isArray(apiKeyValue) ? apiKeyValue[0] : apiKeyValue
  const candidate = authorization?.replace(/^Bearer\s+/i, '').trim() || direct?.trim() || ''
  return candidate.length <= 256 ? candidate : ''
}

function firstHeader(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value
  const normalized = candidate?.trim() ?? ''
  return normalized.length <= 512 ? normalized : ''
}

function declaredBodySize(request: FastifyRequest): number | null {
  const value = firstHeader(request.headers['content-length'])
  if (!/^\d{1,12}$/.test(value)) return null
  const bytes = Number(value)
  return Number.isSafeInteger(bytes) ? bytes : null
}

function sessionIdentity(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): PromptSessionIdentity | { value: string; source: 'header_session' | 'header_conversation' } | null {
  const sessionId = firstHeader(headers['x-original-session-id'])
  if (sessionId) return { value: sessionId, source: 'header_session' }
  const conversationId = firstHeader(headers['x-original-conversation-id'])
  if (conversationId) return { value: conversationId, source: 'header_conversation' }
  return extractPromptSessionIdentity(body)
}

export function registerPromptCaptureRoute(app: FastifyInstance, input: {
  captureSecret: string
  maxRequestBodyBytes: () => number
  service: Pick<PromptAuditService, 'enqueue' | 'store'>
}): void {
  app.addContentTypeParser(
    PROMPT_CAPTURE_CONTENT_TYPE,
    { parseAs: 'string', bodyLimit: PROMPT_CAPTURE_BODY_LIMIT },
    (_request, body, done) => done(null, body),
  )
  app.addContentTypeParser(
    PROMPT_WS_CAPTURE_CONTENT_TYPE,
    { parseAs: 'string', bodyLimit: PROMPT_CAPTURE_BODY_LIMIT },
    (_request, body, done) => done(null, body),
  )

  const authorizeAndLimit = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!secretMatches(request.headers['x-ops-capture-secret'] as string | undefined, input.captureSecret)) {
      await reply.code(404).send()
      return
    }
    const bytes = declaredBodySize(request)
    const configuredLimit = Math.min(PROMPT_CAPTURE_BODY_LIMIT, Math.max(1, input.maxRequestBodyBytes()))
    if (bytes === null || bytes > configuredLimit) {
      await reply.code(204).send()
    }
  }

  app.post('/internal/prompts/capture', {
    bodyLimit: PROMPT_CAPTURE_BODY_LIMIT,
    onRequest: authorizeAndLimit,
  }, async (request, reply) => {
    const requestId = normalizedRequestId(request.headers['x-request-id'])
    if (!requestId || typeof request.body !== 'string') {
      await reply.code(202).send({ accepted: false })
      return
    }
    let body: unknown
    try {
      body = JSON.parse(request.body)
    } catch {
      await reply.code(202).send({ accepted: false })
      return
    }
    const parsed = parsePrompt(body)
    const identity = sessionIdentity(request.headers, body)
    const accepted = parsed ? input.service.enqueue({
      ...parsed,
      requestId,
      endpoint: request.headers['x-original-uri'] as string || '/v1/responses',
      capturedAt: new Date(),
      apiKey: apiKeyFromHeaders(request.headers),
      sessionFingerprint: identity ? createHash('sha256').update(identity.value).digest('hex') : '',
      sessionSource: identity?.source ?? '',
    }) : false
    await reply.code(202).send({ accepted })
  })

  app.post('/internal/prompts/capture/ws', {
    bodyLimit: PROMPT_CAPTURE_BODY_LIMIT,
    onRequest: authorizeAndLimit,
  }, async (request, reply) => {
    const requestId = normalizedRequestId(request.headers['x-request-id'])
    const connectionId = normalizedRequestId(request.headers['x-ws-connection-id'])
    const sequenceValue = firstHeader(request.headers['x-ws-message-sequence'])
    const sequence = /^\d{1,9}$/.test(sequenceValue) ? Number(sequenceValue) : 0
    if (!requestId || !connectionId || sequence < 1 || requestId !== `${connectionId}.ws.${sequence}` || typeof request.body !== 'string') {
      await reply.code(400).send({ stored: false })
      return
    }
    let body: unknown
    try {
      body = JSON.parse(request.body)
    } catch {
      await reply.code(204).send()
      return
    }
    const parsed = parseWebSocketPrompt(body)
    if (!parsed) {
      await reply.code(204).send()
      return
    }
    const capturedAtValue = firstHeader(request.headers['x-captured-at'])
    const capturedAt = new Date(capturedAtValue)
    if (!capturedAtValue || !Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000) {
      await reply.code(400).send({ stored: false })
      return
    }
    const identity = sessionIdentity(request.headers, body)
    await input.service.store({
      ...parsed,
      requestId,
      endpoint: firstHeader(request.headers['x-original-uri']) || '/v1/responses#websocket',
      capturedAt,
      apiKey: '',
      sessionFingerprint: identity ? createHash('sha256').update(identity.value).digest('hex') : '',
      sessionSource: identity?.source ?? '',
    })
    await reply.code(201).send({ stored: true })
  })
}
