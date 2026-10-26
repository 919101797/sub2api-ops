import { RequestLimitsStore } from '../request-limits/policy.js'
import { RequestGuard } from '../request-limits/guard.js'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'

import type { WsRelayConfig } from './config.js'
import { createWsAuditRelay } from './server.js'
import { WsAuditOutbox } from './outbox.js'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
  vi.useRealTimers()
  vi.restoreAllMocks()
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
    socket.once('close', (code) => reject(new Error(`WS closed ${code} before returning a frame`)))
  })
}

async function heartbeatRelay() {
  const root = await mkdtemp(join(tmpdir(), 'ws-heartbeat-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const store = new RequestLimitsStore(join(root, 'policy.json')); await store.initialize()
  await store.save({ revision: (await store.read()).revision, defaultMaxMiB: 2, largeThresholdMiB: 1, maxLargeConcurrent: 1, userOverrides: [] }, 'admin')
  const guard = new RequestGuard(store, async () => 1)
  const upstream = createServer()
  const sockets = new WebSocketServer({ server: upstream })
  let upstreamMessages = 0
  const connected = new Promise<WebSocket>(resolve => sockets.once('connection', peer => {
    peer.on('message', data => { upstreamMessages++; peer.send(data) })
    resolve(peer)
  }))
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => sockets.close(() => upstream.close(() => resolve()))))
  const relay = await createWsAuditRelay({ WS_RELAY_HOST: '127.0.0.1', WS_RELAY_PORT: 0,
    WS_RELAY_UPSTREAM_ORIGIN: `ws://127.0.0.1:${(upstream.address() as {port:number}).port}`,
    WS_AUDIT_CAPTURE_URL: 'http://127.0.0.1:1/capture', WS_AUDIT_OUTBOX_PATH: join(root, 'outbox'),
    WS_AUDIT_OUTBOX_MAX_BYTES: 512 * 1024 * 1024, REQUEST_LIMITS_PATH: store.path, PROMPT_CAPTURE_SECRET: 's'.repeat(32),
  }, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, guard)
  await relay.listen(); cleanup.push(() => relay.close())
  const client = new WebSocket(`ws://127.0.0.1:${relay.address()!.port}/v1/responses`, {
    headers: { authorization: 'Bearer heartbeat-test', 'x-request-id': 'heartbeat-test' },
  })
  client.on('error', () => {}); cleanup.push(async () => client.terminate())
  await waitForOpen(client)
  return { client, peer: await connected, guard, messages: () => upstreamMessages }
}

it('场景-007-07：真实 WS 控制帧只在传输层保活，业务请求只转发一次', async () => {
  const interval = globalThis.setInterval
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: (...args: unknown[]) => void, delay: number) =>
    interval(fn, delay === 25_000 ? 10 : delay)) as typeof setInterval)
  const fresh = await heartbeatRelay()
  let pings = 0
  fresh.client.on('ping', () => { pings++ })
  await vi.waitFor(() => expect(pings).toBeGreaterThanOrEqual(6), { timeout: 2000 })
  const response = waitForMessage(fresh.client)
  fresh.client.send('after idle')
  expect(await response).toBe('after idle')
  expect(fresh.messages()).toBe(1)
})

it('场景-007-08：客户端异常断开立即关闭上游并释放大请求通道', async () => {
  const { client, peer, guard } = await heartbeatRelay()
  expect(guard.gate.active).toBe(1)
  const closed = new Promise<number>(resolve => peer.once('close', resolve))
  client.terminate()
  expect(await closed).toBe(1006)
  await vi.waitFor(() => expect(guard.gate.active).toBe(0))
})

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
      REQUEST_LIMITS_PATH: join(outboxPath, 'policy.json'),
      PROMPT_CAPTURE_SECRET: 's'.repeat(32),
    }
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const store = new RequestLimitsStore(config.REQUEST_LIMITS_PATH); await store.initialize()
    const initial = await store.read()
    await store.save({ revision: initial.revision, defaultMaxMiB: 25, largeThresholdMiB: 30, maxLargeConcurrent: 1, userOverrides: [] }, 'test')
    const guard = new RequestGuard(store, async () => 1)
    const relay = await createWsAuditRelay(config, logger, guard)
    await relay.listen()
    cleanup.push(() => relay.close())
    const relayAddress = relay.address()
    if (!relayAddress) throw new Error('Relay test server did not bind')

    const client = new WebSocket(`ws://127.0.0.1:${relayAddress.port}/v1/responses?mode=test`, {
      perMessageDeflate: false,
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
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/responses' }), 'WS 审计连接已建立')
    expect(forwarded.authorization).toBe('Bearer test-api-key')
    expect(forwarded['x-request-id']).toBe('nginx-connection-id')
    expect(forwarded['openai-beta']).toBe('responses_websockets=2026-02-06')

    // 场景-007-06：上限以内完整接收，不截断正文。
    const largePayload = 'x'.repeat(25 * 1024 * 1024)
    const largeEcho = waitForMessage(client)
    client.send(largePayload)
    const echoedLargePayload = await largeEcho
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    expect(Buffer.byteLength(echoedLargePayload)).toBe(25 * 1024 * 1024)
    expect(hash(echoedLargePayload)).toBe(hash(largePayload))
    await vi.waitFor(() => expect(captures).toHaveLength(3), { timeout: 5000, interval: 10 })
    expect(hash(captures[2]!.body)).toBe(hash(largePayload))

    // 场景-007-05：落盘阻塞时不能无限积压大对话；未落盘内容不转发。
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(WsAuditOutbox.prototype, 'persist').mockImplementation(async () => gate)
    const blocked = [client]
    for (let index=0; index<4; index++) {
      const peer = new WebSocket(`ws://127.0.0.1:${relayAddress.port}/v1/responses`, { perMessageDeflate:false, headers:{ authorization:'Bearer test-api-key','x-request-id':`blocked-${index}` } })
      await waitForOpen(peer); blocked.push(peer)
    }
    const closed = Promise.race(blocked.map(peer => new Promise<number>(resolve => peer.once('close',resolve))))
    for (const peer of blocked) peer.send(Buffer.alloc(25 * 1024 * 1024,120))
    try {
      await expect(Promise.race([closed, new Promise((_,reject) => setTimeout(() => reject(new Error('queue was not bounded')),2500))])).resolves.toBe(1013)
      const health = await fetch(`http://127.0.0.1:${relayAddress.port}/health`).then(r => r.json()) as {pendingBytes:number}
      expect(health.pendingBytes).toBeLessThanOrEqual(104 * 1024 * 1024)
      expect(captures).toHaveLength(3)
    } finally { for (const peer of blocked) peer.terminate(); release() }

    const oversized = new WebSocket(`ws://127.0.0.1:${relayAddress.port}/v1/responses`, {
      perMessageDeflate: false, headers: { authorization: 'Bearer test-api-key', 'x-request-id': 'oversized-connection' },
    })
    await waitForOpen(oversized)
    const oversizedClosed = new Promise<number>((resolve) => oversized.once('close', resolve))
    oversized.send(Buffer.alloc(25 * 1024 * 1024 + 1, 120))
    try { expect(await oversizedClosed).toBe(1009) } finally { oversized.terminate() }
  }, 15000)
})

it('场景-012-06：WS 按用户额度握手、保护大额连接、热更新后重连并检查解压消息大小', async () => {
  const root=await mkdtemp(join(tmpdir(),'ws-policy-')); cleanup.push(() => rm(root,{recursive:true,force:true}))
  const store=new RequestLimitsStore(join(root,'policy.json')); await store.initialize()
  const first=await store.read()
  const values={defaultMaxMiB:1,largeThresholdMiB:1,maxLargeConcurrent:1,userOverrides:[{userId:1,maxMiB:2}]}
  await store.save({revision:first.revision,...values},'admin')
  const guard=new RequestGuard(store,async key => key==='owner' ? 1 : key==='other' ? 2 : null)
  const upstream=createServer(); const ws=new WebSocketServer({server:upstream})
  ws.on('connection',peer => peer.on('message',(data,isBinary) => peer.send(data,{binary:isBinary})))
  await new Promise<void>(r => upstream.listen(0,'127.0.0.1',r))
  cleanup.push(() => new Promise<void>(r => ws.close(() => upstream.close(() => r()))))
  const capture=createServer((req,res) => { req.resume(); req.on('end',() => res.writeHead(201).end()) })
  await new Promise<void>(r => capture.listen(0,'127.0.0.1',r))
  cleanup.push(() => new Promise<void>(r => capture.close(() => r())))
  const relay=await createWsAuditRelay({WS_RELAY_HOST:'127.0.0.1',WS_RELAY_PORT:0,WS_RELAY_UPSTREAM_ORIGIN:`ws://127.0.0.1:${(upstream.address() as {port:number}).port}`,WS_AUDIT_CAPTURE_URL:`http://127.0.0.1:${(capture.address() as {port:number}).port}/capture`,WS_AUDIT_OUTBOX_PATH:join(root,'outbox'),WS_AUDIT_OUTBOX_MAX_BYTES:512*1024*1024,REQUEST_LIMITS_PATH:store.path,PROMPT_CAPTURE_SECRET:'s'.repeat(32)}, {error:vi.fn(),warn:vi.fn(),info:vi.fn()},guard)
  await relay.listen(); cleanup.push(() => relay.close())
  const url=`ws://127.0.0.1:${relay.address()!.port}/responses`
  const connect=(key:string,id:string) => new WebSocket(url,{perMessageDeflate:true,headers:{authorization:`Bearer ${key}`,'x-request-id':id,'x-user-id':'1'}})
  const owner=connect('owner','owner-conn'); owner.on('error',()=>{}); cleanup.push(async () => owner.terminate()); await waitForOpen(owner)
  expect(guard.gate.active).toBe(1)
  const echoed=waitForMessage(owner); owner.send('x'.repeat(1024*1024+1)); expect((await echoed).length).toBe(1024*1024+1)
  const denied=connect('owner','busy-conn'); denied.on('error',()=>{})
  expect(await new Promise<number>(r => denied.once('unexpected-response',(_req,res) => {res.resume();r(res.statusCode!);denied.terminate()}))).toBe(429)
  // 场景-012-13：仅调整其他用户和通道数量，不打断当前用户。
  const before = await store.read()
  const unrelated = await store.save({revision:before.revision,...values,maxLargeConcurrent:3,userOverrides:[...values.userOverrides,{userId:2,maxMiB:1}]},'admin')
  const continued = waitForMessage(owner); owner.send('still running'); expect(await continued).toBe('still running')
  await store.save({revision:unrelated.revision,...values,maxLargeConcurrent:3,userOverrides:[{userId:1,maxMiB:2},{userId:2,maxMiB:1}]},'another-admin')
  const unchanged = waitForMessage(owner); owner.send('unchanged'); expect(await unchanged).toBe('unchanged')
  const latest=await store.read(); await store.save({revision:latest.revision,...values,userOverrides:[]},'admin')
  const reconnected=new Promise<number>(r => owner.once('close',r)); owner.send('next'); expect(await reconnected).toBe(1012)
  await vi.waitFor(() => expect(guard.gate.active).toBe(0))
  const ordinary=connect('other','small-conn'); ordinary.on('error',()=>{}); cleanup.push(async () => ordinary.terminate()); await waitForOpen(ordinary)
  const closed=new Promise<number>(r => ordinary.once('close',r)); ordinary.send('x'.repeat(1024*1024+1)); expect(await closed).toBe(1009)
},10000)

it('场景-012-08：两个 65 MiB 连接可同时建立且落盘消息合计超过 104 MiB，达到配置数才拒绝', async () => {
  const mib = 1024 * 1024
  const root = await mkdtemp(join(tmpdir(), 'ws-concurrency-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const store = new RequestLimitsStore(join(root, 'policy.json')); await store.initialize()
  const initial = await store.read()
  await store.save({ revision: initial.revision, defaultMaxMiB: 30, largeThresholdMiB: 30, maxLargeConcurrent: 2, userOverrides: [{ userId: 1, maxMiB: 65 }] }, 'admin')
  const guard = new RequestGuard(store, async () => 1)
  const upstream = createServer(); const ws = new WebSocketServer({ server: upstream })
  ws.on('connection', peer => peer.on('message', (data, isBinary) => peer.send(data, { binary: isBinary })))
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r))
  cleanup.push(() => new Promise<void>(r => ws.close(() => upstream.close(() => r()))))
  const relay = await createWsAuditRelay({ WS_RELAY_HOST: '127.0.0.1', WS_RELAY_PORT: 0, WS_RELAY_UPSTREAM_ORIGIN: `ws://127.0.0.1:${(upstream.address() as {port:number}).port}`, WS_AUDIT_CAPTURE_URL: 'http://127.0.0.1:1/capture', WS_AUDIT_OUTBOX_PATH: join(root, 'outbox'), WS_AUDIT_OUTBOX_MAX_BYTES: 512 * mib, REQUEST_LIMITS_PATH: store.path, PROMPT_CAPTURE_SECRET: 's'.repeat(32) }, { error: vi.fn(), warn: vi.fn(), info: vi.fn() }, guard)
  await relay.listen(); cleanup.push(() => relay.close())
  const url = `ws://127.0.0.1:${relay.address()!.port}/v1/responses`
  const connect = (id: string) => {
    const peer = new WebSocket(url, { perMessageDeflate: false, headers: { authorization: 'Bearer owner', 'x-request-id': id } })
    peer.on('error', () => {}); cleanup.push(async () => peer.terminate()); return peer
  }
  const first = connect('large-first'); await waitForOpen(first)
  const second = connect('large-second'); await waitForOpen(second)
  expect(guard.gate.active).toBe(2)
  const denied = connect('large-third')
  expect(await new Promise<number>(r => denied.once('unexpected-response', (_req, res) => { res.resume(); r(res.statusCode!); denied.terminate() }))).toBe(429)
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const persist = vi.spyOn(WsAuditOutbox.prototype, 'persist').mockImplementation(async () => held)
  const received = [first, second].map(peer => new Promise<number>((resolve, reject) => {
    peer.once('message', data => resolve((data as Buffer).byteLength))
    peer.once('close', code => reject(new Error(`closed ${code} before forwarding`)))
  }))
  try {
    for (const peer of [first, second]) peer.send(Buffer.alloc(53 * mib, 120))
    await vi.waitFor(async () => {
      expect(persist).toHaveBeenCalledTimes(2)
      const health = await fetch(`http://127.0.0.1:${relay.address()!.port}/health`).then(r => r.json()) as { pendingBytes: number }
      expect(health.pendingBytes).toBe(106 * mib)
    }, { timeout: 5000 })
    release()
    expect(await Promise.all(received)).toEqual([53 * mib, 53 * mib])
    first.terminate(); second.terminate()
    await vi.waitFor(() => expect(guard.gate.active).toBe(0))
  } finally { release(); first.terminate(); second.terminate(); await Promise.allSettled(received) }
}, 15000)
