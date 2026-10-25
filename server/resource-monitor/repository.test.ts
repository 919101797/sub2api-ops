import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { ResourceRepository, registerResourceRoutes } from './repository.js'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })))
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'resource-monitor-'))
  directories.push(directory)
  const path = join(directory, 'metrics.sqlite3')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE samples (at INTEGER PRIMARY KEY, boot TEXT, host TEXT, containers TEXT, disks TEXT)')
  const write = (at: number, availableBytes = 1000, workingSetBytes = 200, boot = 'boot-1') => db.prepare('INSERT INTO samples VALUES (?,?,?,?,?)').run(
    at, boot, JSON.stringify({ totalBytes: 2000, availableBytes, swapTotalBytes: 4000, swapUsedBytes: 100, swapInBytesPerSecond: null, swapOutBytesPerSecond: null }),
    JSON.stringify([{ id: 'abc', name: 'sub2api', usedBytes: 300, workingSetBytes, rssBytes: 180, cacheBytes: 120, swapBytes: 0, limitBytes: null, peakBytes: 500, failCount: 0 }]),
    JSON.stringify([{ device: 'vda', readAwaitMs: null, writeAwaitMs: 3, busyPercent: 10 }]),
  )
  return { db, path, write }
}
describe('independent resource history', () => {
  it('场景-011-04：历史压缩保留低可用内存和容器峰值，断档不伪造零', () => {
    const { db, path, write } = fixture()
    write(1000, 1000, 200)
    write(1015, 100, 900)
    write(1200, 800, 300, 'boot-2')
    db.close()
    const result = new ResourceRepository(path).query(900, 1300, 1300, 2)
    expect(result.points).toHaveLength(2)
    expect(result.points[0]!.availableBytes).toBe(100)
    expect(result.points[0]!.containers.sub2api).toBe(900)
    expect(result.points[1]!.gap).toBe(true)
    expect(result.latest!.host.swapInBytesPerSecond).toBeNull()
    expect(result.stale).toBe(true)
    expect(result.sampleCount).toBe(3)
  })
  it('场景-011-05：未安装采样器返回明确错误，未登录不能读取', async () => {
    const app = Fastify()
    registerResourceRoutes(app, '/ops/api', async (_req, reply) => { await reply.code(401).send({ error: '未登录' }) }, new ResourceRepository('/missing'))
    expect((await app.inject('/ops/api/resources')).statusCode).toBe(401)
    await app.close()
    const authorized = Fastify()
    registerResourceRoutes(authorized, '/ops/api', async () => {}, new ResourceRepository('/missing'))
    const response = await authorized.inject('/ops/api/resources')
    expect(response.statusCode).toBe(503)
    expect(response.json().error).toContain('尚未安装')
    expect((await authorized.inject('/ops/api/resources?startAt=bad')).statusCode).toBe(400)
    expect((await authorized.inject('/ops/api/resources?startAt=2026-01-01T00:00:00Z&endAt=2026-02-01T00:00:00Z')).statusCode).toBe(400)
    await authorized.close()
  })
})
