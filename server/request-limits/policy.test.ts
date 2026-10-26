// @vitest-environment node
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { RequestLimitsStore, limitForUser, requestLimitsInputSchema } from './policy.js'

it('场景-012-01/04：默认 30、用户 70，原子保存、重启读取及旧版本冲突', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'request-policy-'))
  try {
    const store = new RequestLimitsStore(join(dir, 'policy.json'))
    await store.initialize()
    const first = await store.read()
    expect(limitForUser(first.policy, 2)).toBe(30)
    const input = { revision: first.revision, defaultMaxMiB: 30, largeThresholdMiB: 30, maxLargeConcurrent: 1, userOverrides: [{ userId: 1, maxMiB: 70 }] }
    const saved = await store.save(input, 'admin@example.com')
    expect(limitForUser(saved.policy, 1)).toBe(70)
    expect(limitForUser(saved.policy, 2)).toBe(30)
    expect((await new RequestLimitsStore(join(dir, 'policy.json')).read()).revision).toBe(saved.revision)
    await expect(store.save(input, 'admin')).rejects.toMatchObject({ status: 409 })
    await expect(store.save({ ...input, revision: saved.revision, defaultMaxMiB: 101 }, 'admin')).rejects.toThrow()
    await expect(store.save({ ...input, revision: saved.revision, userOverrides: [{ userId: 1, maxMiB: 70 }, { userId: 1, maxMiB: 60 }] }, 'admin')).rejects.toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

it('场景-012-08：大请求并发支持任意安全正整数，拒绝无效数字', () => {
  const input = { revision: 'a'.repeat(64), defaultMaxMiB: 30, largeThresholdMiB: 30, userOverrides: [] }
  for (const maxLargeConcurrent of [3, 10, 1000, Number.MAX_SAFE_INTEGER]) {
    expect(requestLimitsInputSchema.safeParse({ ...input, maxLargeConcurrent }).success).toBe(true)
  }
  for (const maxLargeConcurrent of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(requestLimitsInputSchema.safeParse({ ...input, maxLargeConcurrent }).success).toBe(false)
  }
})

it('场景-012-13：相同设置和例外重排不改策略文件、版本及元数据', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unchanged-policy-'))
  try {
    const store = new RequestLimitsStore(join(dir, 'policy.json')); await store.initialize()
    const first = await store.read()
    const values = { defaultMaxMiB: 30, largeThresholdMiB: 30, maxLargeConcurrent: 20, userOverrides: [{ userId: 1, maxMiB: 70 }, { userId: 2, maxMiB: 60 }] }
    const saved = await store.save({ revision: first.revision, ...values }, 'first-admin')
    const raw = await readFile(store.path, 'utf8')
    expect(await store.save({ revision: saved.revision, ...values, userOverrides: [...values.userOverrides].reverse() }, 'second-admin')).toEqual(saved)
    expect(await readFile(store.path, 'utf8')).toBe(raw)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
