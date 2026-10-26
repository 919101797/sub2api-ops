import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { RequestLimitsInput, RequestLimitsPolicy, RequestLimitsStatus } from '../../shared/request-limits.js'

export const MIB = 1024 * 1024
export const HARD_MAX_MIB = 100
const size = z.number().int().min(1).max(HARD_MAX_MIB)
const values = {
  defaultMaxMiB: size, largeThresholdMiB: size,
  maxLargeConcurrent: z.number().int().positive(),
  userOverrides: z.array(z.strictObject({ userId: z.number().int().positive(), maxMiB: size })).max(500).refine(
    rows => new Set(rows.map(r => r.userId)).size === rows.length, '用户不能重复',
  ),
}
export const requestLimitsInputSchema = z.strictObject({ revision: z.string().regex(/^[a-f0-9]{64}$/), ...values })
const policySchema = z.strictObject({ version: z.literal(1), ...values, updatedAt: z.iso.datetime(), updatedBy: z.string().min(1).max(254) })
export class RequestLimitError extends Error {
  constructor(message: string, readonly status: number, readonly code = 'request_limit_error') { super(message) }
}
export const limitForUser = (policy: RequestLimitsPolicy, userId: number) => policy.userOverrides.find(r => r.userId === userId)?.maxMiB ?? policy.defaultMaxMiB
function settingsKey(settings: Omit<RequestLimitsInput, 'revision'>): string {
  return JSON.stringify([settings.defaultMaxMiB, settings.largeThresholdMiB, settings.maxLargeConcurrent,
    [...settings.userOverrides].sort((a, b) => a.userId - b.userId)])
}
export class RequestLimitsStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly path: string) {}
  async initialize() {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    try { await this.read() }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const policy: RequestLimitsPolicy = { version: 1, defaultMaxMiB: 30, largeThresholdMiB: 30, maxLargeConcurrent: 1, userOverrides: [], updatedAt: new Date().toISOString(), updatedBy: 'system' }
      const file = await open(this.path, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(policy)); await file.sync() } finally { await file.close() }
    }
  }
  async read(): Promise<RequestLimitsStatus> {
    const raw = await readFile(this.path)
    if (raw.length > 65_536) throw new Error('请求大小策略文件超过上限')
    return { revision: createHash('sha256').update(raw).digest('hex'), policy: policySchema.parse(JSON.parse(raw.toString())) }
  }
  async save(value: RequestLimitsInput, actor: string): Promise<RequestLimitsStatus> {
    const task = this.queue.then(async () => {
      const { revision, ...settings } = requestLimitsInputSchema.parse(value)
      const current = await this.read()
      if (current.revision !== revision) throw new RequestLimitError('策略已变化，请重新载入后保存', 409)
      if (settingsKey(current.policy) === settingsKey(settings)) return current
      const policy = policySchema.parse({ ...settings, version: 1, updatedAt: new Date().toISOString(), updatedBy: actor })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(JSON.stringify(policy)); await file.sync() } finally { await file.close() }
        await rename(temporary, this.path)
        const dir = await open(dirname(this.path), 'r')
        try { await dir.sync() } finally { await dir.close() }
        return await this.read()
      } finally { await unlink(temporary).catch(() => {}) }
    })
    this.queue = task.catch(() => {})
    return task
  }
}
