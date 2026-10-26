import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { RequestLimitError, RequestLimitsStore, requestLimitsInputSchema } from './policy.js'

export function registerRequestLimitsRoutes(app: FastifyInstance, prefix: string,
  protect: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  actor: (request: FastifyRequest) => string,
  record: (summary: string) => Promise<unknown>,
  store: RequestLimitsStore,
) {
  const respond = async (reply: FastifyReply, task: () => Promise<unknown>) => {
    reply.header('cache-control', 'no-store')
    try { await reply.send(await task()) }
    catch (error) {
      if (error instanceof z.ZodError) await reply.code(400).send({ error: error.issues[0]?.message ?? '请求大小策略无效' })
      else if (error instanceof RequestLimitError) await reply.code(error.status).send({ error: error.message })
      else { app.log.error({ message: '请求大小策略读写失败' }); await reply.code(503).send({ error: '请求大小策略暂时不可用' }) }
    }
  }
  app.get(`${prefix}/request-limits`, { preHandler: protect }, async (_req, reply) => respond(reply, () => store.read()))
  app.put(`${prefix}/request-limits`, { preHandler: protect }, async (req, reply) => respond(reply, async () => {
    const input = requestLimitsInputSchema.parse(req.body)
    const user = actor(req)
    const result = await store.save(input, user)
    if (result.revision !== input.revision) await record(`管理员 ${user} 更新请求大小：默认 ${input.defaultMaxMiB} MiB，${input.userOverrides.length} 个用户例外，大请求阈值 ${input.largeThresholdMiB} MiB，并发 ${input.maxLargeConcurrent}`).catch(() => app.log.error('请求大小审计写入失败'))
    return result
  }))
}
