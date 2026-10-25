import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, rm, readdir, statfs } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import { join } from 'node:path'
import { PassThrough, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createBrotliDecompress, createZstdDecompress } from 'node:zlib'
import type { RequestGuard } from './guard.js'
import { MIB, RequestLimitError } from './policy.js'
import { startResponseHeaderKeepalive } from './response-keepalive.js'

const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
export function cleanHttpHeaders(input: http.IncomingHttpHeaders) {
  const headers = { ...input }
  for (const name of [...hopHeaders, ...String(input.connection ?? '').toLowerCase().split(',').map(x => x.trim())]) delete headers[name]
  return headers
}
export function gatewayError(response: ServerResponse, error: unknown) {
  if (response.destroyed || response.headersSent) { response.destroy(); return }
  const known = error instanceof RequestLimitError
  const status = known ? error.status : 502
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(status === 429 ? { 'retry-after': '5' } : {}) })
  response.end(JSON.stringify({ error: { message: known ? error.message : '请求网关暂时不可用', type: known ? error.code : 'gateway_error' } }))
}
export async function prepareHttpSpool(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && /^request-[A-Za-z0-9]+$/.test(entry.name)) await rm(join(root, entry.name), { recursive: true })
  }
}
export function createHttpGateway(guard: RequestGuard, upstreamOrigin: string, spoolRoot: string, logger?: { info(values: Record<string, unknown>, message: string): void }) {
  const origin = new URL(upstreamOrigin)
  const transport = origin.protocol === 'https:' ? https : http
  return async (request: IncomingMessage, response: ServerResponse) => {
    let directory: string | undefined
    let release: (() => void) | undefined
    let keepalive: ReturnType<typeof startResponseHeaderKeepalive> | undefined
    const started = performance.now()
    let userId: number | undefined, bytes = 0, authMs: number | undefined, uploadMs: number | undefined
    let forwardStarted: number | undefined, headerAt: number | undefined, upstreamStatus: number | undefined
    const suppliedId = request.headers['x-request-id']
    const requestId = typeof suppliedId === 'string' && /^[a-f0-9]{32}$/i.test(suppliedId) ? suppliedId : randomUUID()
    try {
      const identity = await guard.authorize(request.headers, request.url)
      userId = identity.userId
      authMs = Math.round(performance.now() - started)
      if (response.destroyed || request.destroyed) return
      const encoding = String(request.headers['content-encoding'] ?? 'identity').toLowerCase()
      const decoders = { gzip: createGunzip, br: createBrotliDecompress, zstd: createZstdDecompress }
      if (encoding !== 'identity' && !(encoding in decoders)) throw new RequestLimitError('不支持的请求压缩格式', 415)
      const oversized = () => new RequestLimitError(`请求超过该用户 ${identity.maxBytes / MIB} MiB 上限`, 413, 'request_too_large')
      const declared = Number(request.headers['content-length'])
      if (encoding === 'identity' && Number.isFinite(declared) && declared > identity.maxBytes) throw oversized()
      await mkdir(spoolRoot, { recursive: true, mode: 0o700 })
      const disk = await statfs(spoolRoot)
      if (disk.bavail * disk.bsize < identity.maxBytes + 128 * MIB) throw new RequestLimitError('临时磁盘空间不足，请稍后重试', 507, 'request_storage_full')
      directory = await mkdtemp(join(spoolRoot, 'request-'))
      const path = join(directory, 'body')
      // 不让 pipeline 的超限错误销毁客户端 socket，保留可读的 413 响应。
      const source = new PassThrough()
      const aborted = () => source.destroy(new Error('client aborted'))
      request.once('aborted', aborted)
      request.once('error', aborted)
      const decoder = encoding === 'identity' ? null : decoders[encoding as keyof typeof decoders]()
      const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        callback(bytes > identity.maxBytes ? oversized() : null, chunk)
      } })
      request.pipe(source)
      try { await pipeline([source, ...(decoder ? [decoder] : []), counter, createWriteStream(path, { mode: 0o600, flags: 'wx' })]) }
      catch (error) {
        request.unpipe(source); request.resume()
        if (error instanceof RequestLimitError) throw error
        if (request.aborted) return
        if (/^(?:ENOSPC|EIO|EROFS|EACCES)$/.test((error as NodeJS.ErrnoException).code ?? '')) throw new RequestLimitError('请求临时存储不可用', 503)
        throw new RequestLimitError('请求正文或压缩内容无效', 400)
      } finally { request.off('aborted', aborted); request.off('error', aborted) }
      uploadMs = Math.round(performance.now() - started - authMs)
      if (response.destroyed) return
      if (bytes > identity.policy.largeThresholdMiB * MIB) release = guard.gate.acquire(identity.policy.maxLargeConcurrent)
      const headers = cleanHttpHeaders(request.headers)
      headers.host = origin.host
      headers['content-length'] = String(bytes)
      delete headers['content-encoding']
      // 保活期间尚不知道上游头，SSE 必须保持未压缩；出口压缩交给 Nginx。
      headers['accept-encoding'] = 'identity'
      // 只向固定内网源站发送，不接受客户端绝对 URL 或外部地址。
      const incoming = new URL(request.url ?? '/', 'http://gateway.invalid')
      forwardStarted = performance.now()
      keepalive = startResponseHeaderKeepalive(request, response)
      await new Promise<void>((resolve, reject) => {
        let upstreamResponse: IncomingMessage | undefined
        const body = createReadStream(path)
        const up = transport.request(origin, { method: request.method, path: incoming.pathname + incoming.search, headers }, res => {
          upstreamResponse = res
          headerAt = performance.now()
          upstreamStatus = res.statusCode ?? 502
          keepalive!.stop()
          if (keepalive!.sent && (upstreamStatus < 200 || upstreamStatus >= 300 || !String(res.headers['content-type']).toLowerCase().startsWith('text/event-stream'))) {
            keepalive!.fail(upstreamStatus >= 300 ? upstreamStatus : 502)
            res.destroy()
            resolve()
            return
          }
          const output = cleanHttpHeaders(res.headers)
          if (!response.headersSent) {
            response.writeHead(upstreamStatus, output)
            response.flushHeaders()
          }
          void pipeline(res, response).then(resolve, reject)
        })
        const closed = () => { if (!response.writableFinished) { body.destroy(); up.destroy(); upstreamResponse?.destroy() } }
        response.once('close', closed)
        up.setTimeout(3600_000, () => up.destroy(new Error('upstream timeout')))
        up.on('error', reject)
        up.on('close', () => { response.off('close', closed); if (!upstreamResponse) reject(new Error('upstream closed')) })
        body.on('error', error => up.destroy(error))
        body.pipe(up)
      })
    } catch (error) {
      if (keepalive?.sent && headerAt === undefined) keepalive.fail(502)
      else gatewayError(response, error)
      request.resume()
    }
    finally {
      keepalive?.stop()
      release?.()
      const ended = performance.now()
      logger?.info({ requestId, userId, bodyBytes: bytes, authMs, uploadMs,
        upstreamHeadersMs: forwardStarted === undefined ? undefined : Math.round((headerAt ?? ended) - forwardStarted),
        responseMs: headerAt === undefined ? undefined : Math.round(ended - headerAt),
        totalMs: Math.round(ended - started), upstreamStatus, status: response.statusCode,
        keepalive: keepalive?.sent ?? false, clientDisconnected: response.destroyed && !response.writableFinished,
      }, 'HTTP gateway request completed')
      if (directory) await rm(directory, { recursive: true, force: true })
    }
  }
}
