// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { StateStore } from '../store.js'
import { Sub2ApiClient } from '../sub2api-client.js'
import { QuotaRedistributor } from './redistribution.js'
import type { AccountConfig } from '../../shared/contracts.js'

const directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'quota-redistribution-')); directories.push(dir)
  const path = join(dir, 'state.json'), store = new StateStore(path); await store.initialize()
  const config: AccountConfig = { key: 'one', email: 'one@example.com', label: '账号一', enabled: true, shareCount: 3,
    reserveMode: 'usd', reserveValue: 100, targetGroupIds: [5, 13], redistributionEnabled: true }
  await store.ensureAccounts([config])
  const client = new Sub2ApiClient('http://example.test', 'secret', 1000)
  const groups = [5, 13].map(id => ({ id, name: `Group ${id}`, rate_multiplier: 1, daily_limit_usd: null, weekly_limit_usd: 300, monthly_limit_usd: null }))
  const update = vi.spyOn(client, 'updateGroupWeeklyLimit').mockImplementation(async (group, limit) => { groups.find(g => g.id === group.id)!.weekly_limit_usd = limit; return { ...group, weekly_limit_usd: limit } })
  const input = { resetAt: 2000000000, usedPercent: 40, standardCostUsd: 400, estimatedCycleCapacityUsd: 1000, reserveUsd: 100, resetReady: true,
    groups, subscriptions: [ { id: 1, user_id: 1, group_id: 5, status: 'active' as const, weekly_usage_usd: 300 }, { id: 2, user_id: 2, group_id: 13, status: 'active' as const, weekly_usage_usd: 50 } ] }
  const service = new QuotaRedistributor(client, store, () => config)
  return { config, input, groups, store, client, update, service, path }
}
it('场景-003-08/09/10：给所有分组等额追加，同样用量不重复，后续再次耗尽可继续', async () => {
  const f = await fixture()
  await f.service.run(f.config, f.input)
  expect(f.update.mock.calls.map(c => [c[0].id, c[1]])).toEqual([[5,466.66],[13,466.66]])
  expect(f.store.snapshot().accounts.one!.redistribution).toMatchObject({ rounds: 1, totalAddedPerShareUsd: 166.66 })
  await f.service.run(f.config, f.input)
  expect(f.update).toHaveBeenCalledTimes(2)
  f.input.subscriptions[0]!.weekly_usage_usd = 466.66
  await f.service.run(f.config, { ...f.input, standardCostUsd: 600, usedPercent: 60 })
  expect(f.groups.map(g => g.weekly_limit_usd)).toEqual([566.66,566.66])
  expect(f.store.snapshot().accounts.one!.redistribution!.rounds).toBe(2)
})
it('场景-003-12：部分失败后重启只继续同一轮，不重复增加已完成组', async () => {
  const f = await fixture()
  f.update.mockImplementationOnce(async group => ({ ...group, weekly_limit_usd: (f.groups[0]!.weekly_limit_usd = 466.66) }))
    .mockRejectedValueOnce(new Error('temporary upstream error'))
  await expect(f.service.run(f.config, f.input)).rejects.toThrow()
  expect(f.store.snapshot().accounts.one!.redistribution!.pending!.completedGroupIds).toEqual([5])
  const store = new StateStore(f.path); await store.initialize(); await store.ensureAccounts([f.config])
  await new QuotaRedistributor(f.client, store, () => f.config).run(f.config, f.input)
  expect(f.update.mock.calls.filter(c => c[0].id === 5)).toHaveLength(1)
  expect(store.snapshot().accounts.one!.redistribution).toMatchObject({ rounds: 1, totalAddedPerShareUsd: 166.66 })
})
it('场景-003-11/13：关闭、不足一美分、上游已满或重置未完成不追加，新周期不继承旧下限', async () => {
  const f = await fixture()
  for (const input of [{ ...f.input, resetReady: false }, { ...f.input, usedPercent: 100 }, { ...f.input, standardCostUsd: 899.99 }]) await f.service.run(f.config, input)
  expect(f.update).not.toHaveBeenCalled()
  f.config.redistributionEnabled = false
  await f.service.run(f.config, f.input)
  expect(f.update).not.toHaveBeenCalled()
  f.config.redistributionEnabled = true
  await f.service.run(f.config, f.input)
  await f.service.run(f.config, { ...f.input, resetAt: f.input.resetAt + 604800, resetReady: false })
  expect(f.store.snapshot().accounts.one!.redistribution!.message).toContain('重置')
  await f.service.run(f.config, { ...f.input, resetAt: f.input.resetAt + 604800, subscriptions: f.input.subscriptions.map(s => ({ ...s, weekly_usage_usd: 0 })) })
  expect(f.store.snapshot().accounts.one!.redistribution).toMatchObject({ rounds: 0, limits: [] })
})
it('场景-003-11：成员用量未知时不发放', async () => {
  const f = await fixture()
  await f.service.run(f.config, { ...f.input, subscriptions: [{ ...f.input.subscriptions[0]!, weekly_usage_usd: Number.NaN }] })
  expect(f.update).not.toHaveBeenCalled()
})

it('场景-003-12：上游已写入但响应丢失时，重读绝对目标避免重复追加', async () => {
  const f = await fixture()
  f.update.mockImplementationOnce(async () => { f.groups[0]!.weekly_limit_usd = 466.66; throw new Error('response lost') })
  await expect(f.service.run(f.config, f.input)).rejects.toThrow('response lost')
  await f.service.run(f.config, f.input)
  expect(f.update.mock.calls.filter(c => c[0].id === 5)).toHaveLength(1)
  expect(f.groups.map(g => g.weekly_limit_usd)).toEqual([466.66,466.66])
  expect(f.store.snapshot().accounts.one!.redistribution!.rounds).toBe(1)
})
