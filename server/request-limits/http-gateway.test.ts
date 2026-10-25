// @vitest-environment node
import http, { createServer } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import { RequestGuard } from './guard.js'
import { RequestLimitsStore, MIB } from './policy.js'
import { createHttpGateway } from './http-gateway.js'

it('场景-012-01/02/03/05：按真实用户限制、chunked/压缩不能绕过、并发与取消清理', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'request-gateway-'))
  const store = new RequestLimitsStore(join(dir, 'policy.json')); await store.initialize()
  const first = await store.read()
  await store.save({ revision: first.revision, defaultMaxMiB: 1, largeThresholdMiB: 1, maxLargeConcurrent: 1, userOverrides: [{ userId: 1, maxMiB: 2 }] }, 'admin')
  const resolver = vi.fn(async (key: string) => key === 'owner' || key === 'owner-2' ? 1 : key === 'other' ? 2 : null)
  const guard = new RequestGuard(store, resolver)
  const received: number[] = []; let finish!: () => void
  const upstream = createServer((req, res) => {
    let bytes = 0; req.on('data', (chunk: Buffer) => { bytes += chunk.length })
    req.on('end', () => { received.push(bytes); if (req.url === '/v1/hold') { res.writeHead(200); res.write('start'); finish = () => res.end('done') } else res.end(String(bytes)) })
  })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${(upstream.address() as {port:number}).port}`
  const spool = join(dir, 'spool')
  const gateway = createServer(createHttpGateway(guard, origin, spool))
  await new Promise<void>(r => gateway.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(gateway.address() as {port:number}).port}`
  const send = (body: Buffer, key = 'other', path = '/v1/responses', extra: Record<string,string> = {}) => fetch(url + path, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-user-id': '1', ...extra }, body })
  try {
    expect(await (await send(Buffer.alloc(MIB))).text()).toBe(String(MIB))
    expect((await send(Buffer.alloc(MIB + 1))).status).toBe(413)
    expect((await send(Buffer.alloc(31 * MIB))).status).toBe(413)
    const rawStatus = await new Promise<number>((resolve,reject) => {
      const body=Buffer.alloc(31*MIB)
      const req=http.request(url+'/v1/responses',{method:'POST',headers:{authorization:'Bearer other','content-length':body.length}},res=>{res.resume();resolve(res.statusCode!)})
      req.on('error',reject);req.end(body)
    })
    expect(rawStatus).toBe(413)

    expect((await send(Buffer.alloc(MIB + 1), 'owner-2')).status).toBe(200)
    expect((await send(gzipSync(Buffer.alloc(MIB + 1)), 'other', '/v1/responses/compact', { 'content-encoding': 'gzip' })).status).toBe(413)
    const chunked = await new Promise<number>((resolve,reject) => {
      const req = http.request(url + '/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer other' } }, res => { res.resume(); resolve(res.statusCode!) })
      req.on('error', reject); req.write(Buffer.alloc(MIB)); req.end(Buffer.alloc(1))
    })
    expect(chunked).toBe(413)
    expect((await send(Buffer.alloc(1), 'forged')).status).toBe(401)
    resolver.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await send(Buffer.alloc(1))).status).toBe(503)
    const abort = new AbortController()
    const held = await fetch(url + '/v1/hold', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: Buffer.alloc(MIB+1), signal: abort.signal })
    expect(held.status).toBe(200)
    expect((await send(Buffer.alloc(MIB+1),'owner')).status).toBe(429)
    expect((await send(Buffer.alloc(1))).status).toBe(200)
    abort.abort(); finish()
    await vi.waitFor(() => expect(guard.gate.active).toBe(0))
    await vi.waitFor(async () => expect(await readdir(spool)).toEqual([]))
    expect(received.filter(n => n === MIB+1)).toHaveLength(2)
  } finally {
    finish?.(); gateway.closeAllConnections(); upstream.closeAllConnections()
    await Promise.all([new Promise<void>(r => gateway.close(() => r())), new Promise<void>(r => upstream.close(() => r()))])
    await rm(dir, { recursive: true, force: true })
  }
})

it('场景-012-09：8 个小请求等待模型返回时，第 9 个请求仍可上传和转发', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-upload-slots-'))
  const store = new RequestLimitsStore(join(dir, 'policy.json')); await store.initialize()
  const guard = new RequestGuard(store, async () => 1)
  const pending = new Set<http.ServerResponse>()
  const upstream = createServer((req, res) => {
    req.resume()
    req.once('end', () => {
      if (req.url === '/v1/hold') { pending.add(res); res.once('close', () => pending.delete(res)); res.writeHead(200); res.write('start') }
      else res.end('ok')
    })
  })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r))
  const gateway = createServer(createHttpGateway(guard, `http://127.0.0.1:${(upstream.address() as {port:number}).port}`, join(dir, 'spool')))
  await new Promise<void>(r => gateway.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(gateway.address() as {port:number}).port}`
  const aborts: AbortController[] = []
  const heldResponses: Response[] = []
  try {
    for (let i = 0; i < 8; i++) {
      const abort = new AbortController(); aborts.push(abort)
      const response = await fetch(url + '/v1/hold', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: 'small prompt', signal: abort.signal })
      expect(response.status).toBe(200)
      heldResponses.push(response)
    }
    expect(heldResponses).toHaveLength(8)
    expect(pending.size).toBe(8)
    const ninth = await fetch(url + '/v1/responses', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: 'next prompt' })
    expect(ninth.status).toBe(200)
    expect(await ninth.text()).toBe('ok')
  } finally {
    for (const abort of aborts) abort.abort()
    for (const response of pending) response.end()
    gateway.closeAllConnections(); upstream.closeAllConnections()
    await Promise.all([new Promise<void>(r => gateway.close(() => r())), new Promise<void>(r => upstream.close(() => r()))])
    await rm(dir, { recursive: true, force: true })
  }
})


it('场景-012-10/11：等待响应头时保活，晚到错误使用 SSE，普通错误保持 HTTP 状态', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-keepalive-'))
  const store = new RequestLimitsStore(join(dir, 'policy.json')); await store.initialize()
  const guard = new RequestGuard(store, async () => 1)
  const waiting: http.ServerResponse[] = []
  const upstream = createServer((req, res) => { req.resume(); req.once('end', () => waiting.push(res)) })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r))
  const gateway = createServer(createHttpGateway(guard, `http://127.0.0.1:${(upstream.address() as {port:number}).port}`, join(dir, 'spool')))
  await new Promise<void>(r => gateway.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(gateway.address() as {port:number}).port}`
  const send = (accept: string, path = '/v1/responses') => fetch(url + path, { method: 'POST', headers: { authorization: 'Bearer owner', accept }, body: '{"stream":true}' })
  try {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const responsePromise = send('text/event-stream')
    await vi.waitFor(() => expect(waiting.length).toBe(1))
    await vi.advanceTimersByTimeAsync(10_000)
    const response = await responsePromise
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(': keepalive')
    waiting[0]!.writeHead(200, { 'content-type': 'text/event-stream' }); waiting[0]!.end('event: response.completed\ndata: {"type":"response.completed"}\n\n')
    let tail = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; tail += new TextDecoder().decode(chunk.value) }
    expect(tail).toBe('event: response.completed\ndata: {"type":"response.completed"}\n\n')

    const failedPromise = send('text/event-stream')
    await vi.waitFor(() => expect(waiting.length).toBe(2))
    await vi.advanceTimersByTimeAsync(10_000)
    const failed = await failedPromise
    waiting[1]!.writeHead(502, { 'content-type': 'application/json' }); waiting[1]!.end('{"error":"private upstream detail"}')
    const errorStream = await failed.text()
    expect(errorStream).toContain('event: error\n')
    expect(errorStream).toContain('502')
    expect(errorStream).not.toContain('private upstream detail')

    for (const [accept, path] of [['application/json', '/v1/responses'], ['text/event-stream', '/v1/responses/compact']]) {
      const index = waiting.length
      const ordinaryPromise = send(accept!, path)
      await vi.waitFor(() => expect(waiting.length).toBe(index + 1))
      await vi.advanceTimersByTimeAsync(10_000)
      waiting[index]!.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' }); waiting[index]!.end('{"error":"busy"}')
      const ordinary = await ordinaryPromise
      expect(ordinary.status).toBe(429)
      expect(ordinary.headers.get('retry-after')).toBe('7')
      expect(await ordinary.text()).toBe('{"error":"busy"}')
    }
    expect(waiting).toHaveLength(4)
  } finally {
    vi.useRealTimers()
    for (const response of waiting) response.end()
    gateway.closeAllConnections(); upstream.closeAllConnections()
    await Promise.all([new Promise<void>(r => gateway.close(() => r())), new Promise<void>(r => upstream.close(() => r()))])
    await rm(dir, { recursive: true, force: true })
  }
}, 15_000)

it('场景-012-10：保活后的取消与上游断连及时释放资源，日志只含耗时和标识', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-cancel-'))
  const store = new RequestLimitsStore(join(dir, 'policy.json')); await store.initialize()
  const first = await store.read()
  await store.save({ revision: first.revision, defaultMaxMiB: 2, largeThresholdMiB: 1, maxLargeConcurrent: 1, userOverrides: [] }, 'admin')
  const guard = new RequestGuard(store, async () => 1)
  const logger = { info: vi.fn() }
  const waiting: http.ServerResponse[] = []
  const upstream = createServer((req, res) => { req.resume(); req.once('end', () => waiting.push(res)) })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r))
  const spool = join(dir, 'spool')
  const gateway = createServer(createHttpGateway(guard, `http://127.0.0.1:${(upstream.address() as {port:number}).port}`, spool, logger))
  await new Promise<void>(r => gateway.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(gateway.address() as {port:number}).port}/v1/responses?key=private-query`
  try {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const abort = new AbortController()
    const pending = fetch(url, { method: 'POST', headers: { authorization: 'Bearer private-key', accept: 'text/event-stream' }, body: Buffer.alloc(MIB + 1), signal: abort.signal })
    await vi.waitFor(() => expect(waiting).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(10_000)
    const response = await pending
    expect(response.status).toBe(200)
    abort.abort()
    await vi.waitFor(() => expect(guard.gate.active).toBe(0))
    await vi.waitFor(async () => expect(await readdir(spool)).toEqual([]))
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, bodyBytes: MIB + 1, keepalive: true, clientDisconnected: true, authMs: expect.any(Number), upstreamHeadersMs: expect.any(Number), totalMs: expect.any(Number) }), 'HTTP gateway request completed')
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/private-query|private-key/)
    expect(vi.getTimerCount()).toBe(0)

    const failedPromise = fetch(url, { method: 'POST', headers: { authorization: 'Bearer private-key', accept: 'text/event-stream' }, body: 'prompt' })
    await vi.waitFor(() => expect(waiting).toHaveLength(2))
    await vi.advanceTimersByTimeAsync(10_000)
    const failed = await failedPromise
    waiting[1]!.destroy()
    expect(await failed.text()).toContain('event: error\n')
    await vi.waitFor(async () => expect(await readdir(spool)).toEqual([]))
    expect(vi.getTimerCount()).toBe(0)

    const earlyPromise = fetch(url, { method: 'POST', headers: { authorization: 'Bearer private-key', accept: 'text/event-stream' }, body: 'prompt' })
    await vi.waitFor(() => expect(waiting).toHaveLength(3))
    waiting[2]!.writeHead(429, { 'content-type': 'application/json', 'retry-after': '5' }); waiting[2]!.end('{"error":"busy"}')
    const early = await earlyPromise
    expect(early.status).toBe(429)
    expect(early.headers.get('retry-after')).toBe('5')
    expect(await early.text()).toBe('{"error":"busy"}')
    expect(waiting).toHaveLength(3)
  } finally {
    vi.useRealTimers()
    for (const response of waiting) response.end()
    gateway.closeAllConnections(); upstream.closeAllConnections()
    await Promise.all([new Promise<void>(r => gateway.close(() => r())), new Promise<void>(r => upstream.close(() => r()))])
    await rm(dir, { recursive: true, force: true })
  }
})

it('场景-012-12：8 个小请求仍在上传时，第 9 个可直接上传完成并转发', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-unlimited-uploads-'))
  const store = new RequestLimitsStore(join(dir, 'policy.json')); await store.initialize()
  const guard = new RequestGuard(store, async () => 1)
  const received: string[] = []
  const upstream = createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += String(chunk) })
    req.once('end', () => { received.push(body); res.end(body) })
  })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r))
  const spool = join(dir, 'spool')
  const gateway = createServer(createHttpGateway(guard, `http://127.0.0.1:${(upstream.address() as {port:number}).port}`, spool))
  await new Promise<void>(r => gateway.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(gateway.address() as {port:number}).port}/v1/responses`
  const requests: http.ClientRequest[] = [], responses: Promise<{ status: number; body: string }>[] = []
  const start = (body: string) => {
    let request!: http.ClientRequest
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      request = http.request(url, { method: 'POST', headers: { authorization: 'Bearer owner' } }, res => {
        let text = ''; res.on('data', chunk => { text += String(chunk) }); res.once('end', () => resolve({ status: res.statusCode!, body: text })); res.once('error', reject)
      })
      request.once('error', reject); request.write(body)
    })
    void response.catch(() => {})
    requests.push(request); responses.push(response)
    return { request, response }
  }
  try {
    for (let i = 0; i < 8; i++) start(`partial-${i}`)
    await vi.waitFor(async () => expect(await readdir(spool)).toHaveLength(8))
    const ninth = start('ninth'); ninth.request.end('-complete')
    expect(await ninth.response).toEqual({ status: 200, body: 'ninth-complete' })
    expect(received).toEqual(['ninth-complete'])
    for (let i = 0; i < 8; i++) requests[i]!.end('-complete')
    for (let i = 0; i < 8; i++) expect(await responses[i]).toEqual({ status: 200, body: `partial-${i}-complete` })
    expect(received).toHaveLength(9)
    await vi.waitFor(async () => expect(await readdir(spool)).toEqual([]))
  } finally {
    for (const request of requests) request.destroy()
    gateway.closeAllConnections(); upstream.closeAllConnections()
    await Promise.allSettled(responses)
    await Promise.all([new Promise<void>(r => gateway.close(() => r())), new Promise<void>(r => upstream.close(() => r()))])
    await rm(dir, { recursive: true, force: true })
  }
})
