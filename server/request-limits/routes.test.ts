// @vitest-environment node
import Fastify from 'fastify'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { registerRequestLimitsRoutes } from './routes.js'
import { RequestLimitsStore } from './policy.js'
it('场景-012-04：只允许管理员读写；校验范围和修订；操作人由服务端写入', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'limits-routes-'))
  const store = new RequestLimitsStore(join(dir, 'policy.json')); await store.initialize()
  const record = vi.fn(async () => {})
  const app = Fastify()
  registerRequestLimitsRoutes(app, '/ops/api', async (req, reply) => { if (req.headers.cookie !== 'admin') await reply.code(401).send({ error: '未登录' }) }, () => 'real-admin', record, store)
  try {
    expect((await app.inject('/ops/api/request-limits')).statusCode).toBe(401)
    expect((await app.inject({ method:'PUT',url:'/ops/api/request-limits',payload:{} })).statusCode).toBe(401)
    const current = (await app.inject({url:'/ops/api/request-limits',headers:{cookie:'admin'}})).json()
    const input = { revision: current.revision, defaultMaxMiB: 30, largeThresholdMiB:30,maxLargeConcurrent:5,userOverrides:[{userId:1,maxMiB:70}] }
    const put = (payload: Record<string, unknown>) => app.inject({method:'PUT',url:'/ops/api/request-limits',headers:{cookie:'admin'},payload})
    expect((await put({...input,actor:'forged'})).statusCode).toBe(400)
    expect((await put({...input,maxLargeConcurrent:0})).statusCode).toBe(400)
    expect((await put({...input,defaultMaxMiB:0})).statusCode).toBe(400)
    expect((await put(input)).json().policy.updatedBy).toBe('real-admin')
    expect((await app.inject({url:'/ops/api/request-limits',headers:{cookie:'admin'}})).json().policy.maxLargeConcurrent).toBe(5)
    expect(record).toHaveBeenCalledOnce()
    expect((await put(input)).statusCode).toBe(409)
  } finally { await app.close(); await rm(dir,{recursive:true,force:true}) }
})
