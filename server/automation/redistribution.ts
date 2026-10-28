import { randomUUID } from 'node:crypto'
import type { AccountConfig, QuotaRedistributionRuntime } from '../../shared/contracts.js'
import type { AdminGroup, UserSubscription } from '../sub2api-client.js'
import { Sub2ApiClient } from '../sub2api-client.js'
import { StateStore } from '../store.js'
import { isSameResetWindow, roundUsd } from './estimation.js'

export interface RedistributionInput {
  resetAt: number
  usedPercent: number
  standardCostUsd: number
  estimatedCycleCapacityUsd: number | undefined
  reserveUsd: number | undefined
  resetReady: boolean
  groups: AdminGroup[]
  subscriptions: UserSubscription[]
}
const centsDown = (value: number) => Math.floor((Math.max(0, value) + 1e-9) * 100) / 100

export function freshRedistribution(resetAt: number): QuotaRedistributionRuntime {
  return { resetAt, rounds: 0, totalAddedPerShareUsd: 0, remainingUsd: null, unallocatedUsd: null,
    status: 'waiting', message: '等待检查可分配余量', limits: [] }
}

export class QuotaRedistributor {
  constructor(private readonly client: Sub2ApiClient, private readonly store: StateStore,
    private readonly currentConfig: (key: string) => AccountConfig | undefined, private readonly toleranceSeconds = 300) {}

  async run(config: AccountConfig, input: RedistributionInput): Promise<void> {
    const previous = this.store.snapshot().accounts[config.key]?.redistribution
    if (!config.redistributionEnabled && !previous) return
    const sameWindow = previous && isSameResetWindow(previous.resetAt, input.resetAt, this.toleranceSeconds)
    const state: QuotaRedistributionRuntime = previous && (sameWindow || !input.resetReady)
      ? structuredClone(previous) : freshRedistribution(input.resetAt)
    const save = async (status: QuotaRedistributionRuntime['status'], message: string) => {
      state.status = status; state.message = message
      await this.store.updateAccount(config.key, account => { account.redistribution = structuredClone(state) })
    }
    const enabled = () => {
      const current = this.currentConfig(config.key)
      return current?.enabled && current.redistributionEnabled
    }
    if (!enabled()) { await save('disabled', '已关闭，保留本周期已追加额度'); return }
    if (!input.resetReady) { await save('waiting', '等待本周期订阅重置完成'); return }
    if (input.estimatedCycleCapacityUsd === undefined || input.reserveUsd === undefined) {
      await save('waiting', '等待有效的周期容量估值'); return
    }
    if (![input.estimatedCycleCapacityUsd, input.reserveUsd, input.standardCostUsd, input.usedPercent].every(Number.isFinite)
      || input.standardCostUsd < 0 || input.usedPercent < 0) throw new Error('再均分所需的容量观测无效')
    state.baseLimitUsd = roundUsd(Math.max(0, input.estimatedCycleCapacityUsd - input.reserveUsd) / config.shareCount)
    state.remainingUsd = centsDown(input.estimatedCycleCapacityUsd - input.standardCostUsd - input.reserveUsd)
    const allocationBase = Math.max(state.committedCapacityUsd ?? 0, input.standardCostUsd)
    const unallocated = (committed: number) => centsDown(input.estimatedCycleCapacityUsd! - input.reserveUsd!
      - Math.max(committed, input.standardCostUsd))
    state.unallocatedUsd = unallocated(state.pending?.committedCapacityUsd ?? allocationBase)
    if (!state.pending && (input.usedPercent >= 100 || state.remainingUsd < config.shareCount * 0.01)) {
      await save('exhausted', input.usedPercent >= 100 ? '上游额度已用尽，停止追加' : '扣除预留后已无可均分余额'); return
    }
    const groups = new Map(input.groups.map(group => [group.id, group]))
    const members = input.subscriptions.filter(subscription => subscription.status === 'active'
      && config.targetGroupIds.includes(subscription.group_id)
      && (!subscription.expires_at || Date.parse(subscription.expires_at) > Date.now()))
    if (!members.length) { await save('waiting', '没有有效成员，暂不追加'); return }
    if (!config.targetGroupIds.length || config.targetGroupIds.some(id => {
      const limit = groups.get(id)?.weekly_limit_usd
      return typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0
    })) { await save('waiting', '目标分组须有有效的有限周限'); return }

    if (!state.pending) {
      if (state.unallocatedUsd < config.shareCount * 0.01) {
        await save('waiting', '当前余量已分配，等待新增可分配额度'); return
      }
      const perShareUsd = Math.floor((state.unallocatedUsd * 100 + 1e-7) / config.shareCount) / 100
      state.pending = { id: randomUUID(), startedAt: new Date().toISOString(), perShareUsd,
        targets: config.targetGroupIds.map(id => ({ groupId: id, limitUsd: roundUsd(groups.get(id)!.weekly_limit_usd! + perShareUsd) })),
        committedCapacityUsd: allocationBase + roundUsd(perShareUsd * config.shareCount), completedGroupIds: [] }
      state.unallocatedUsd = unallocated(state.pending.committedCapacityUsd)
      await save('waiting', '正在均等追加本轮额度')
    }
    const pending = state.pending
    try {
      for (const target of pending.targets) {
        if (pending.completedGroupIds.includes(target.groupId)) continue
        const current = this.currentConfig(config.key)
        if (!enabled()) { await save('disabled', '已关闭，未完成轮次保留，重新开启后继续'); return }
        if (!current?.targetGroupIds.includes(target.groupId)) {
          // 管理员已移除的分组不再写入，当前轮次只继续仍受管的目标。
          pending.completedGroupIds.push(target.groupId)
          await save('waiting', '目标分组已变化，继续仍受管的分组')
          continue
        }
        const group = groups.get(target.groupId)
        if (!group) throw new Error(`无法读取再均分目标分组 ${target.groupId}`)
        if (group.weekly_limit_usd! < target.limitUsd - 1e-8) {
          await this.client.updateGroupWeeklyLimit(group, target.limitUsd)
          group.weekly_limit_usd = target.limitUsd
        }
        const limit = Math.max(target.limitUsd, group.weekly_limit_usd!)
        state.limits = [...state.limits.filter(item => item.groupId !== target.groupId), { groupId: target.groupId, limitUsd: limit }]
        pending.completedGroupIds.push(target.groupId)
        await this.store.updateAccount(config.key, account => {
          account.redistribution = structuredClone(state)
          const allocation = account.capacity?.groups.find(item => item.groupId === target.groupId)
          if (allocation) { allocation.targetLimitUsd = limit; allocation.updated = true; allocation.status = 'updated' }
        })
      }
      state.rounds += 1
      state.totalAddedPerShareUsd = roundUsd(state.totalAddedPerShareUsd + pending.perShareUsd)
      state.committedCapacityUsd = pending.committedCapacityUsd
      state.unallocatedUsd = unallocated(state.committedCapacityUsd)
      state.lastAppliedAt = new Date().toISOString()
      delete state.pending
      await save('updated', `第 ${state.rounds} 轮已完成，每份追加 $${pending.perShareUsd.toFixed(2)}`)
      await this.store.addEvent({ category: 'capacity', severity: 'success', accountKey: config.key,
        summary: `${config.label}：第 ${state.rounds} 轮余量再均分，每份追加 $${pending.perShareUsd.toFixed(2)}`,
        details: { roundId: pending.id, resetAt: state.resetAt, perShareUsd: pending.perShareUsd,
          remainingUsd: state.remainingUsd, unallocatedUsd: state.unallocatedUsd, committedCapacityUsd: state.committedCapacityUsd,
          reserveUsd: input.reserveUsd, shareCount: config.shareCount, targets: pending.targets } })
    } catch (error) {
      await save('failed', '本轮部分分组尚未完成，下次继续原目标')
      throw error
    }
  }
}
