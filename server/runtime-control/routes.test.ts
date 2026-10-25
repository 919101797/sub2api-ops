// @vitest-environment node
import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { registerRuntimeRoutes } from './routes.js'
import { RuntimeControlClient, RuntimeControlError } from './client.js'

it('场景-004-08：拒绝未登录、越界及未知字段，服务端注入操作人并保留冲突状态', async () => {
  const client = { status: vi.fn(async () => ({ applying: false })), apply: vi.fn(async () => ({ applying: true })) }
  const actor = () => 'admin@example.com'
  const app = Fastify()
  registerRuntimeRoutes(app, '/ops/api', async () => {}, actor, async () => {}, client as never)
  const input = { revision: 'a'.repeat(64), memoryMiB: 600, dbMaxOpenConnections: 15 }
  expect((await app.inject({ method: 'PUT', url: '/ops/api/resources/runtime', payload: { ...input, memoryMiB: 9999 } })).statusCode).toBe(400)
  expect((await app.inject({ method: 'PUT', url: '/ops/api/resources/runtime', payload: { ...input, actor: 'forged' } })).statusCode).toBe(400)
  expect(client.apply).not.toHaveBeenCalled()
  expect((await app.inject({ method: 'PUT', url: '/ops/api/resources/runtime', payload: input })).statusCode).toBe(202)
  expect(client.apply).toHaveBeenCalledWith({ ...input, actor: 'admin@example.com' })
  client.apply.mockRejectedValueOnce(new RuntimeControlError('配置已变化', 409))
  expect((await app.inject({ method: 'PUT', url: '/ops/api/resources/runtime', payload: input })).statusCode).toBe(409)
  await app.close()
  const denied = Fastify()
  registerRuntimeRoutes(denied, '/ops/api', async (_req, reply) => { await reply.code(401).send({ error: '未登录' }) }, actor, async () => {}, client as never)
  expect((await denied.inject('/ops/api/resources/runtime')).statusCode).toBe(401)
  await denied.close()
})
it('场景-004-06：控制服务未安装返回明确的 503', async () => {
  await expect(new RuntimeControlClient('/missing/control.sock').status()).rejects.toMatchObject({ status: 503 })
})

it('场景-004-07：Unix socket 按固定路径传递参数并读回应用状态', async () => {
  const { createServer } = await import('node:http')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'runtime-socket-'))
  const path = join(dir, 'control.sock')
  let received: unknown
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += String(chunk) })
    req.on('end', () => {
      received = { method: req.method, path: req.url, body: JSON.parse(raw) }
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ applying: true }))
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  try {
    const input = { revision: 'a'.repeat(64), dbMaxOpenConnections: 15, memoryMiB: 600, actor: 'admin' }
    expect(await new RuntimeControlClient(path).apply(input)).toEqual({ applying: true })
    expect(received).toEqual({ method: 'POST', path: '/settings', body: input })
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }) }
})
