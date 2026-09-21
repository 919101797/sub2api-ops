import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'

import WebSocket, { WebSocketServer, type RawData } from 'ws'

import type { WsRelayConfig } from './config.js'
import { WsAuditDelivery, type WsAuditLogger, WsAuditOutbox } from './outbox.js'

const AUDIT_ENDPOINT = '/v1/responses#websocket'
const MAX_BRIDGE_BUFFER_BYTES = 32 * 1024 * 1024
const UPSTREAM_HANDSHAKE_TIMEOUT_MS = 15_000
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
  'upgrade',
])

function requestId(request: IncomingMessage): string | null {
  const value = request.headers['x-request-id']
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && /^[A-Za-z0-9._:-]{1,96}$/.test(candidate) ? candidate : null
}

function subprotocols(request: IncomingMessage): string[] {
  const value = request.headers['sec-websocket-protocol']
  const text = Array.isArray(value) ? value.join(',') : value ?? ''
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

function upstreamHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const forwarded: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue
    forwarded[name] = value
  }
  return forwarded
}

function upstreamUrl(origin: string, request: IncomingMessage): string {
  const incoming = new URL(request.url ?? '/', 'http://relay.invalid')
  return new URL(`${incoming.pathname}${incoming.search}`, origin).toString()
}

function closePeer(peer: WebSocket, code: number, reason: Buffer | string): void {
  const validCode = code === 1000 || (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999)
  if (peer.readyState === WebSocket.OPEN) peer.close(validCode ? code : 1000, validCode ? reason.toString().slice(0, 123) : '')
  else if (peer.readyState === WebSocket.CONNECTING) peer.terminate()
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  throw new TypeError('Unsupported WebSocket message payload')
}

function sendHttpError(socket: Duplex, statusCode: number, statusMessage: string): void {
  if (!socket.writable) return
  const body = `${statusCode} ${statusMessage}\n`
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + 'Connection: close\r\n\r\n'
    + body,
  )
}

export interface WsAuditRelay {
  server: HttpServer
  listen(): Promise<void>
  close(): Promise<void>
  address(): { address: string; port: number } | null
}

export async function createWsAuditRelay(config: WsRelayConfig, logger: WsAuditLogger): Promise<WsAuditRelay> {
  const outbox = new WsAuditOutbox(config.WS_AUDIT_OUTBOX_PATH, config.WS_AUDIT_OUTBOX_MAX_BYTES)
  await outbox.initialize()
  const delivery = new WsAuditDelivery(outbox, config.WS_AUDIT_CAPTURE_URL, config.PROMPT_CAPTURE_SECRET, logger)
  let activeConnections = 0

  const selectedProtocols = new WeakMap<IncomingMessage, string>()
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: config.WS_RELAY_MAX_MESSAGE_BYTES,
    perMessageDeflate: {
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      concurrencyLimit: 4,
      threshold: 1_024,
    },
    handleProtocols: (_protocols, request) => selectedProtocols.get(request) || false,
  })

  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const outboxUsage = await outbox.usage()
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({
        status: 'ok',
        activeConnections,
        outbox: outboxUsage,
      }))
      return
    }
    response.writeHead(404).end()
  })

  const bridge = (client: WebSocket, request: IncomingMessage, upstream: WebSocket, connectionId: string): void => {
    activeConnections += 1
    let sequence = 0
    let clientMessages = Promise.resolve()
    let closed = false

    const finish = (): void => {
      if (closed) return
      closed = true
      activeConnections -= 1
    }

    client.on('message', (data, isBinary) => {
      const payload = rawDataBuffer(data)
      clientMessages = clientMessages.then(async () => {
        sequence += 1
        const capturedAt = new Date().toISOString()
        const id = `${connectionId}.ws.${sequence}`
        await outbox.persist({
          id,
          connectionId,
          sequence,
          capturedAt,
          endpoint: AUDIT_ENDPOINT,
          payload: payload.toString('utf8'),
        })
        delivery.wake()
        if (upstream.readyState !== WebSocket.OPEN) throw new Error('WS upstream closed before message forwarding')
        if (upstream.bufferedAmount > MAX_BRIDGE_BUFFER_BYTES) throw new Error('WS upstream backpressure limit exceeded')
        await new Promise<void>((resolve, reject) => {
          upstream.send(payload, { binary: isBinary }, (error) => error ? reject(error) : resolve())
        })
      }).catch((error) => {
        logger.error({ err: error, connectionId, sequence }, 'WS 消息持久化或转发失败')
        closePeer(client, 1011, 'audit relay failure')
        closePeer(upstream, 1011, 'audit relay failure')
      })
    })

    upstream.on('message', (data, isBinary) => {
      if (client.readyState !== WebSocket.OPEN) return
      if (client.bufferedAmount > MAX_BRIDGE_BUFFER_BYTES) {
        closePeer(client, 1011, 'downstream backpressure limit exceeded')
        closePeer(upstream, 1011, 'downstream backpressure limit exceeded')
        return
      }
      client.send(data, { binary: isBinary }, (error) => {
        if (error) logger.warn({ err: error, connectionId }, 'WS 上游消息回传失败')
      })
    })

    client.on('close', (code, reason) => {
      finish()
      closePeer(upstream, code, reason)
    })
    upstream.on('close', (code, reason) => {
      finish()
      closePeer(client, code, reason)
    })
    client.on('error', (error) => logger.warn({ err: error, connectionId }, 'WS 客户端连接异常'))
    upstream.on('error', (error) => logger.warn({ err: error, connectionId }, 'WS 上游连接异常'))

    logger.info({ connectionId, path: request.url }, 'WS 审计连接已建立')
  }

  server.on('upgrade', (request, socket, head) => {
    const incoming = new URL(request.url ?? '/', 'http://relay.invalid')
    if (incoming.pathname !== '/v1/responses') {
      sendHttpError(socket, 404, 'Not Found')
      return
    }
    const connectionId = requestId(request)
    if (!connectionId) {
      sendHttpError(socket, 400, 'Missing X-Request-ID')
      return
    }

    socket.pause()
    const protocols = subprotocols(request)
    const upstream = new WebSocket(
      upstreamUrl(config.WS_RELAY_UPSTREAM_ORIGIN, request),
      protocols.length > 0 ? protocols : undefined,
      {
        headers: upstreamHeaders(request.headers),
        handshakeTimeout: UPSTREAM_HANDSHAKE_TIMEOUT_MS,
        maxPayload: config.WS_RELAY_MAX_MESSAGE_BYTES,
        perMessageDeflate: true,
      },
    )
    let settled = false

    const fail = (statusCode: number, statusMessage: string, error?: unknown): void => {
      if (settled) return
      settled = true
      logger.warn({ err: error, connectionId, statusCode }, 'WS 上游握手失败')
      upstream.terminate()
      sendHttpError(socket, statusCode, statusMessage)
    }

    socket.once('close', () => {
      if (!settled) upstream.terminate()
    })
    upstream.once('unexpected-response', (_request, response) => {
      fail(response.statusCode ?? 502, response.statusMessage || 'Upstream Rejected')
      response.resume()
    })
    upstream.once('error', (error) => fail(502, 'Bad Gateway', error))
    upstream.once('open', () => {
      if (settled || socket.destroyed) {
        upstream.terminate()
        return
      }
      settled = true
      if (upstream.protocol) selectedProtocols.set(request, upstream.protocol)
      webSocketServer.handleUpgrade(request, socket, head, (client) => {
        webSocketServer.emit('connection', client, request)
        bridge(client, request, upstream, connectionId)
      })
      socket.resume()
    })
  })

  delivery.start()

  return {
    server,
    listen: () => new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.WS_RELAY_PORT, config.WS_RELAY_HOST, () => {
        server.off('error', reject)
        resolve()
      })
    }),
    close: async () => {
      for (const client of webSocketServer.clients) client.close(1001, 'server shutdown')
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await delivery.close()
      webSocketServer.close()
    },
    address: () => {
      const address = server.address()
      return address && typeof address !== 'string' ? { address: address.address, port: address.port } : null
    },
  }
}
