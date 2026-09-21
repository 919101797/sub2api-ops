import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { WsAuditDelivery, WsAuditOutbox } from './outbox.js'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

describe('WS audit outbox', () => {
  it('persists messages before delivery and removes them only after acknowledgement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ws-audit-outbox-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const outbox = new WsAuditOutbox(directory)
    await outbox.initialize()
    const capturedAt = new Date().toISOString()
    await outbox.persist({
      id: 'connection-1.ws.1',
      connectionId: 'connection-1',
      sequence: 1,
      capturedAt,
      endpoint: '/v1/responses#websocket',
      payload: '{"type":"response.create","input":"完整输入"}',
    })
    expect(await outbox.pendingCount()).toBe(1)
    expect(await outbox.entries()).toEqual([expect.objectContaining({ id: 'connection-1.ws.1', capturedAt })])

    let attempts = 0
    const captureServer = createServer((_request, response) => {
      attempts += 1
      response.writeHead(attempts === 1 ? 503 : 201).end()
    })
    await new Promise<void>((resolve) => captureServer.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve) => captureServer.close(() => resolve())))
    const address = captureServer.address()
    if (!address || typeof address === 'string') throw new Error('Capture test server did not bind')
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const delivery = new WsAuditDelivery(outbox, `http://127.0.0.1:${address.port}/capture`, 'x'.repeat(32), logger, 10, 20)
    cleanup.push(() => delivery.close())
    delivery.start()

    await vi.waitFor(async () => expect(await outbox.pendingCount()).toBe(0), { timeout: 2_000, interval: 10 })
    expect(attempts).toBe(2)
  })
})
