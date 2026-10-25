import type { IncomingMessage, ServerResponse } from 'node:http'

// 只为明确接受 Responses SSE 的客户端提前写出注释；JSON/compact 保持 HTTP 语义。
export function startResponseHeaderKeepalive(request: IncomingMessage, response: ServerResponse) {
  const path = new URL(request.url ?? '/', 'http://gateway.invalid').pathname
  const acceptsSse = String(request.headers.accept ?? '').toLowerCase().split(',').some(part => {
    const [type, ...parameters] = part.trim().split(';')
    return type?.trim() === 'text/event-stream' && !parameters.some(value => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(value))
  })
  const enabled = request.method === 'POST' && /^(?:\/v1|\/backend-api\/codex)?\/responses\/?$/.test(path) && acceptsSse
  let sent = false
  const timer = enabled ? setInterval(() => {
    if (response.destroyed || response.writableEnded || response.writableNeedDrain) return
    if (!response.headersSent) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' })
    }
    response.write(': keepalive\n\n')
    sent = true
  }, 10_000) : undefined
  timer?.unref()
  return {
    get sent() { return sent },
    stop() { if (timer) clearInterval(timer) },
    fail(status: number) {
      if (response.destroyed || response.writableEnded) return
      const error = { type: 'error', sequence_number: 0, code: 'gateway_upstream_error', message: `Sub2API 返回 HTTP ${status}，本次响应未完成`, param: null }
      response.end(`event: error\ndata: ${JSON.stringify(error)}\n\n`)
    },
  }
}
