import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'

import type { WsRelayConfig } from './config.js'
import { createWsAuditRelay } from './server.js'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(data.toString()))
    socket.once('error', reject)
  })
}

describe('WS audit relay', () => {
  it('forwards frames unchanged while durably delivering every client turn', async () => {
    const upstreamServer = createServer()
    const upstreamWs = new WebSocketServer({ server: upstreamServer })
    await new Promise<void>((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve) => upstreamWs.close(() => upstreamServer.close(() => resolve()))))
    const upstreamAddress = upstreamServer.address()
    if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('Upstream test server did not bind')

    const upstreamHeaders = new Promise<Record<string, string | string[] | undefined>>((resolve) => {
      upstreamWs.once('connection', (socket, request) => {
        resolve(request.headers)
        socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }))
      })
    })

    const captures: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = []
    const captureServer = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        captures.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
        response.writeHead(201).end()
      })
    })
    await new Promise<void>((resolve) => captureServer.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve) => captureServer.close(() => resolve())))
    const captureAddress = captureServer.address()
    if (!captureAddress || typeof captureAddress === 'string') throw new Error('Capture test server did not bind')

    const outboxPath = await mkdtemp(join(tmpdir(), 'ws-audit-relay-'))
    cleanup.push(() => rm(outboxPath, { recursive: true, force: true }))
    const config: WsRelayConfig = {
      WS_RELAY_HOST: '127.0.0.1',
      WS_RELAY_PORT: 0,
      WS_RELAY_UPSTREAM_ORIGIN: `ws://127.0.0.1:${upstreamAddress.port}`,
      WS_AUDIT_CAPTURE_URL: `http://127.0.0.1:${captureAddress.port}/internal/prompts/capture/ws`,
      WS_AUDIT_OUTBOX_PATH: outboxPath,
      WS_AUDIT_OUTBOX_MAX_BYTES: 512 * 1024 * 1024,
      WS_RELAY_MAX_MESSAGE_BYTES: 16 * 1024 * 1024,
      PROMPT_CAPTURE_SECRET: 's'.repeat(32),
    }
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const relay = await createWsAuditRelay(config, logger)
    await relay.listen()
    cleanup.push(() => relay.close())
    const relayAddress = relay.address()
    if (!relayAddress) throw new Error('Relay test server did not bind')

    const client = new WebSocket(`ws://127.0.0.1:${relayAddress.port}/v1/responses?mode=test`, {
      headers: {
        authorization: 'Bearer test-api-key',
        'x-request-id': 'nginx-connection-id',
        'openai-beta': 'responses_websockets=2026-02-06',
      },
    })
    await waitForOpen(client)
    const payloads = [
      JSON.stringify({ type: 'response.create', model: 'gpt-5.6', input: `第一条 ${'甲'.repeat(300)}` }),
      JSON.stringify({ type: 'response.create', model: 'gpt-5.6', input: `第二条 ${'乙'.repeat(300)}` }),
    ]
    for (const payload of payloads) {
      const echoed = waitForMessage(client)
      client.send(payload)
      expect(await echoed).toBe(payload)
    }

    await vi.waitFor(() => expect(captures).toHaveLength(2), { timeout: 2_000, interval: 10 })
    expect(captures.map((item) => item.body)).toEqual(payloads)
    expect(captures.map((item) => item.headers['x-request-id'])).toEqual([
      'nginx-connection-id.ws.1',
      'nginx-connection-id.ws.2',
    ])
    const forwarded = await upstreamHeaders
    expect(forwarded.authorization).toBe('Bearer test-api-key')
    expect(forwarded['x-request-id']).toBe('nginx-connection-id')
    expect(forwarded['openai-beta']).toBe('responses_websockets=2026-02-06')

    client.close()
    await new Promise<void>((resolve) => client.once('close', () => resolve()))
  })
})
