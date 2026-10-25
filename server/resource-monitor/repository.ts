import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { ResourcePoint, ResourceSample, ResourcesResponse } from '../../shared/resources.js'

const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
const maxNullable = (a: number | null, b: number | null): number | null => a === null ? b : b === null ? a : Math.max(a, b)
type Row = { at: number; boot: string; host: string; containers: string; disks: string }
function decode(row: Row): ResourceSample {
  return { at: iso(row.at), bootId: row.boot, host: JSON.parse(row.host), containers: JSON.parse(row.containers), disks: JSON.parse(row.disks) }
}
export class ResourceRepository {
  constructor(private readonly path = '/resource-monitor/metrics.sqlite3') {}

  query(start: number, end: number, now = Date.now() / 1000, maxPoints = 480): ResourcesResponse {
    if (!existsSync(this.path)) throw new Error('独立采样器尚未安装，暂无资源记录')
    const db = new DatabaseSync(this.path, { readOnly: true, timeout: 500 })
    try {
      const last = db.prepare('SELECT * FROM samples ORDER BY at DESC LIMIT 1').get() as Row | undefined
      const first = db.prepare('SELECT at FROM samples ORDER BY at LIMIT 1').get() as { at: number } | undefined
      const bucketSeconds = Math.max(15, Math.ceil((end - start + 1) / maxPoints))
      const points = new Map<number, ResourcePoint>()
      let previous: Row | undefined
      let sampleCount = 0
      for (const raw of db.prepare('SELECT * FROM samples WHERE at >= ? AND at <= ? ORDER BY at').iterate(start, end)) {
        const row = raw as Row
        const sample = decode(row)
        const key = Math.floor((row.at - start) / bucketSeconds)
        let point = points.get(key)
        const gap = previous !== undefined && (row.at - previous.at > 45 || row.boot !== previous.boot)
        if (!point) {
          point = { at: sample.at, lastAt: sample.at, gap, availableBytes: sample.host.availableBytes, swapUsedBytes: sample.host.swapUsedBytes,
            swapInBytesPerSecond: null, swapOutBytesPerSecond: null, diskAwaitMs: null, containers: {} }
          points.set(key, point)
        }
        point.lastAt = sample.at
        point.gap ||= gap
        point.availableBytes = Math.min(point.availableBytes, sample.host.availableBytes)
        point.swapUsedBytes = Math.max(point.swapUsedBytes, sample.host.swapUsedBytes)
        point.swapInBytesPerSecond = maxNullable(point.swapInBytesPerSecond, sample.host.swapInBytesPerSecond)
        point.swapOutBytesPerSecond = maxNullable(point.swapOutBytesPerSecond, sample.host.swapOutBytesPerSecond)
        for (const disk of sample.disks) point.diskAwaitMs = maxNullable(point.diskAwaitMs, maxNullable(disk.readAwaitMs, disk.writeAwaitMs))
        for (const container of sample.containers) point.containers[container.name] = Math.max(point.containers[container.name] ?? 0, container.workingSetBytes)
        previous = row
        sampleCount += 1
      }
      return { generatedAt: iso(now), firstRecordedAt: first ? iso(first.at) : null, sampleIntervalSeconds: 15, retentionDays: 7,
        bucketSeconds, sampleCount, stale: !last || now - last.at > 45, latest: last ? decode(last) : null, points: [...points.values()] }
    } finally { db.close() }
  }
}

const querySchema = z.object({
  startAt: z.iso.datetime({ offset: true }).optional(),
  endAt: z.iso.datetime({ offset: true }).optional(),
})
export function registerResourceRoutes(app: FastifyInstance, prefix: string,
  protectedRoute: (request: FastifyRequest, reply: FastifyReply) => Promise<void>, repository = new ResourceRepository()): void {
  let cache: { key: string; expires: number; value: ResourcesResponse } | undefined
  app.get(`${prefix}/resources`, { preHandler: protectedRoute }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: '查询时间无效' })
    const now = Math.floor(Date.now() / 1000)
    const end = parsed.data.endAt ? Date.parse(parsed.data.endAt) / 1000 : now
    const start = parsed.data.startAt ? Date.parse(parsed.data.startAt) / 1000 : end - 3600
    if (end <= start || end - start > 7 * 86400 || end > now + 60) return reply.code(400).send({ error: '查询时间须在七天以内，结束时间不能晚于现在' })
    const key = `${Math.floor(start / 15)}:${Math.floor(end / 15)}`
    reply.header('cache-control', 'no-store')
    try {
      if (cache?.key === key && cache.expires > Date.now()) return cache.value
      const value = repository.query(start, end, now)
      cache = { key, expires: Date.now() + 15_000, value }
      return value
    } catch (error) {
      request.log.warn({ err: error }, '独立资源记录暂不可读')
      return reply.code(503).send({ error: error instanceof Error && error.message.includes('尚未安装')
        ? error.message : '独立资源记录暂不可读，请检查采样服务和只读挂载' })
    }
  })
}
