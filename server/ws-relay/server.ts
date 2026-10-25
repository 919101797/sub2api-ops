import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { join } from 'node:path'
import { isGatewayPath } from '../request-limits/paths.js'
import { createHttpGateway, prepareHttpSpool } from '../request-limits/http-gateway.js'
import { RequestGuard, type RequestIdentity } from '../request-limits/guard.js'
import { HARD_MAX_MIB, MIB, RequestLimitError } from '../request-limits/policy.js'

import WebSocket, { WebSocketServer, type RawData } from 'ws'

import type { WsRelayConfig } from './config.js'
import { WsAuditDelivery, type WsAuditLogger, WsAuditOutbox } from './outbox.js'

const AUDIT_ENDPOINT = '/v1/responses#websocket'
const MAX_BRIDGE_BUFFER_BYTES = 32 * 1024 * 1024
const MAX_PENDING_BYTES = 104 * 1024 * 1024
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
    + (statusCode === 429 ? 'Retry-After: 5\r\n' : '')
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

export async function createWsAuditRelay(config: WsRelayConfig, logger: WsAuditLogger, guard: RequestGuard): Promise<WsAuditRelay> {
  const outbox = new WsAuditOutbox(config.WS_AUDIT_OUTBOX_PATH, config.WS_AUDIT_OUTBOX_MAX_BYTES)
  await outbox.initialize()
  const delivery = new WsAuditDelivery(outbox, config.WS_AUDIT_CAPTURE_URL, config.PROMPT_CAPTURE_SECRET, logger)
  let activeConnections = 0
  let pendingBytes = 0
  let pendingSmallBytes = 0

  const clients = new Set<WebSocket>()
  const httpOrigin = new URL(config.WS_RELAY_UPSTREAM_ORIGIN)
  httpOrigin.protocol = httpOrigin.protocol === 'wss:' ? 'https:' : 'http:'
  const spool = join(config.WS_AUDIT_OUTBOX_PATH, 'http-requests')
  await prepareHttpSpool(spool)
  const httpGateway = createHttpGateway(guard, httpOrigin.origin, spool, logger)

  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const outboxUsage = await outbox.usage()
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({
        status: 'ok',
        activeConnections,
        pendingBytes,
        activeLargeRequests: guard.gate.active,
        outbox: outboxUsage,
      }))
      return
    }
    if (isGatewayPath(new URL(request.url ?? '/', 'http://relay.invalid').pathname)) {
      await httpGateway(request, response); return
    }
    response.writeHead(404).end()
  })

  const bridge = (client: WebSocket, request: IncomingMessage, upstream: WebSocket, connectionId: string, identity: RequestIdentity): void => {
    clients.add(client)
    activeConnections += 1
    let sequence = 0
    let clientMessages = Promise.resolve()
    let closed = false
    let connectionPendingBytes = 0
    const isLargeConnection = identity.maxBytes > identity.policy.largeThresholdMiB * MIB

    const finish = (): void => {
      if (closed) return
      closed = true
      activeConnections -= 1
      clients.delete(client)
      client.resume()
    }

    client.on('message', (data, isBinary) => {
      if (closed) return
      const payload = rawDataBuffer(data)
      if (connectionPendingBytes + payload.byteLength > identity.maxBytes || (!isLargeConnection && pendingSmallBytes + payload.byteLength > MAX_PENDING_BYTES)) {
        logger.warn({ connectionId, pendingBytes, messageBytes: payload.byteLength }, 'WS 待落盘消息达到内存上限')
        finish()
        closePeer(client, 1013, 'relay pending memory limit exceeded')
        closePeer(upstream, 1013, 'relay pending memory limit exceeded')
        return
      }
      client.pause()
      pendingBytes += payload.byteLength
      connectionPendingBytes += payload.byteLength
      if (!isLargeConnection) pendingSmallBytes += payload.byteLength
      clientMessages = clientMessages.then(async () => {
        if (closed) return
        if ((await guard.store.read()).revision !== identity.revision) {
          finish(); closePeer(client, 1012, 'request policy changed; reconnect'); closePeer(upstream, 1012, 'request policy changed; reconnect'); return
        }
        sequence += 1
        const capturedAt = new Date().toISOString()
        const id = `${connectionId}.ws.${sequence}`
        await outbox.persist({
          id,
          connectionId,
          sequence,
          capturedAt,
          endpoint: AUDIT_ENDPOINT,
          payload,
        })
        delivery.wake()
        if (closed || upstream.readyState !== WebSocket.OPEN) throw new Error('WS upstream closed before message forwarding')
        if (upstream.bufferedAmount > MAX_BRIDGE_BUFFER_BYTES) throw new Error('WS upstream backpressure limit exceeded')
        await new Promise<void>((resolve, reject) => {
          upstream.send(payload, { binary: isBinary }, (error) => error ? reject(error) : resolve())
        })
      }).catch((error) => {
        logger.error({ err: error, connectionId, sequence }, 'WS 消息持久化或转发失败')
        finish()
        closePeer(client, 1011, 'audit relay failure')
        closePeer(upstream, 1011, 'audit relay failure')
      }).finally(() => {
        pendingBytes -= payload.byteLength
        connectionPendingBytes -= payload.byteLength
        if (!isLargeConnection) pendingSmallBytes -= payload.byteLength
        client.resume()
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

    logger.info({ connectionId, path: new URL(request.url ?? '/', 'http://relay.invalid').pathname }, 'WS 审计连接已建立')
  }

  server.on('upgrade', (request, socket, head) => {
    void upgrade(request, socket, head).catch(error => {
      const known = error instanceof RequestLimitError
      logger.warn({ connectionId: requestId(request), statusCode: known ? error.status : 503, code: known ? error.code : 'request_policy_unavailable', activeLargeRequests: guard.gate.active }, 'WS 请求准入被拒绝')
      sendHttpError(socket, known ? error.status : 503, error instanceof RequestLimitError && error.status === 429 ? 'Too Many Requests' : error instanceof RequestLimitError && error.status === 401 ? 'Unauthorized' : 'Service Unavailable')
    })
  })
  const upgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const incoming = new URL(request.url ?? '/', 'http://relay.invalid')
    if (!isGatewayPath(incoming.pathname)) {
      sendHttpError(socket, 404, 'Not Found')
      return
    }
    const connectionId = requestId(request)
    if (!connectionId) {
      sendHttpError(socket, 400, 'Missing X-Request-ID')
      return
    }

    socket.pause()
    const identity = await guard.authorize(request.headers, request.url)
    if (socket.destroyed) return
    const release = identity.maxBytes > identity.policy.largeThresholdMiB * MIB
      ? guard.gate.acquire(identity.policy.maxLargeConcurrent) : () => {}
    socket.once('close', release)
    const protocols = subprotocols(request)
    const upstream = new WebSocket(
      upstreamUrl(config.WS_RELAY_UPSTREAM_ORIGIN, request),
      protocols.length > 0 ? protocols : undefined,
      {
        headers: upstreamHeaders(request.headers),
        handshakeTimeout: UPSTREAM_HANDSHAKE_TIMEOUT_MS,
        maxPayload: HARD_MAX_MIB * MIB,
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
      const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: identity.maxBytes,
        perMessageDeflate: { clientNoContextTakeover: true, serverNoContextTakeover: true, concurrencyLimit: 1, threshold: 1024 },
        handleProtocols: () => upstream.protocol || false,
      })
      socket.once('close', () => webSocketServer.close())
      webSocketServer.handleUpgrade(request, socket, head, (client) => {
        webSocketServer.emit('connection', client, request)
        bridge(client, request, upstream, connectionId, identity)
      })
      socket.resume()
    })
  }

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
      for (const client of clients) client.close(1001, 'server shutdown')
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await delivery.close()
    },
    address: () => {
      const address = server.address()
      return address && typeof address !== 'string' ? { address: address.address, port: address.port } : null
    },
  }
}
