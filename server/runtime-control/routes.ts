import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { RuntimeControlClient, RuntimeControlError } from './client.js'

const inputSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  memoryMiB: z.number().int().min(256).max(768),
  dbMaxOpenConnections: z.number().int().min(1).max(50),
})
export function registerRuntimeRoutes(
  app: FastifyInstance, prefix: string,
  protect: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  actor: (request: FastifyRequest) => string,
  record: (summary: string) => Promise<unknown>,
  client = new RuntimeControlClient(),
) {
  const respond = async (reply: FastifyReply, operation: () => Promise<unknown>, status = 200) => {
    reply.header('cache-control', 'no-store')
    try { await reply.code(status).send(await operation()) }
    catch (error) {
      if (error instanceof z.ZodError) await reply.code(400).send({ error: '请填写有效的连接数和内存上限' })
      else if (error instanceof RuntimeControlError) await reply.code(error.status).send({ error: error.message })
      else { app.log.error({ err: error }, '运行参数操作失败'); await reply.code(503).send({ error: '运行参数操作暂时不可用' }) }
    }
  }
  app.get(`${prefix}/resources/runtime`, { preHandler: protect }, async (_request, reply) => respond(reply, () => client.status()))
  app.put(`${prefix}/resources/runtime`, { preHandler: protect }, async (request, reply) => respond(reply, async () => {
    const input = inputSchema.parse(request.body)
    const operator = actor(request)
    const result = await client.apply({ ...input, actor: operator })
    await record(`管理员 ${operator} 提交 Sub2API 参数：连接池 ${input.dbMaxOpenConnections}，内存 ${input.memoryMiB} MiB；操作 ${result.lastApply?.id ?? 'unknown'}`).catch((error: unknown) => app.log.error({ err: error }, '运行参数审计记录失败'))
    return result
  }, 202))
}
