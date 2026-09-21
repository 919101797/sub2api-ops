import { SelectionRail, SelectionIndicator } from '../components/SelectionRail'
import { useState } from 'react'
import { ArrowUpRight, CircleDot, Search, ShieldOff, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DashboardResponse } from '@shared/contracts'
import { AccountLink } from '@/components/AccountLink'
import { Button, PageHeading, StatusPill } from '@/components/ui'
import { currency, dateTime } from '@/lib/format'

export function AccountsPage({ dashboard }: { dashboard: DashboardResponse }) {
  const [search, setSearch] = useState('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const accounts = dashboard.accounts.filter(
    (account) =>
      `${account.label} ${account.email} ${account.accountId ?? ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (!onlyIssues ||
        account.lastError ||
        account.capacity?.status === 'failed' ||
        account.capacity?.status === 'insufficient-sample' ||
        !account.capacity),
  )
  return (
    <>
      <PageHeading
        title="账号与分组"
        actions={
          <Link className="button button--primary" to="/settings">
            配置账号 <ArrowUpRight size={15} />
          </Link>
        }
      />
      <div className="module-toolbar">
        <label className="filter-search">
          <Search size={16} />
          <input
            aria-label="搜索受管账号"
            placeholder="搜索名称、邮箱或账号 ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <SelectionRail className="segmented-control" role="group" aria-label="账号筛选">
          <button type="button" aria-pressed={!onlyIssues} onClick={() => setOnlyIssues(false)}>
            <SelectionIndicator active={!onlyIssues} />全部账号 <b>{dashboard.accounts.length}</b>
          </button>
          <button type="button" aria-pressed={onlyIssues} onClick={() => setOnlyIssues(true)}>
            <SelectionIndicator active={onlyIssues} />需要关注
          </button>
        </SelectionRail>
      </div>
      <section className="accounts-workspace" aria-label="受管账号列表">
        {accounts.map((account) => {
          const capacity = account.capacity
          const config = dashboard.config.accounts.find((item) => item.key === account.key)
          const infrastructure = dashboard.infrastructure.find((item) => item.accountKey === account.key)
          return (
            <article className="managed-account panel" key={account.key}>
              <AccountLink account={account} {...(infrastructure ? { infrastructure } : {})} />
              <div className="managed-account__metrics">
                <div>
                  <span>账号 ID</span>
                  <strong>{account.accountId ?? '待解析'}</strong>
                </div>
                <div>
                  <span>周期重置</span>
                  <strong>{dateTime(capacity?.resetAt)}</strong>
                </div>
                <div>
                  <span>周期标准成本</span>
                  <strong>{currency(capacity?.localStandardCostUsd)}</strong>
                </div>
                <div>
                  <span>周期估算容量</span>
                  <strong>{currency(capacity?.estimatedCycleCapacityUsd)}</strong>
                </div>
                <div>
                  <span>自动化状态</span>
                  <StatusPill
                    tone={
                      !config?.enabled
                        ? 'neutral'
                        : account.lastError || capacity?.status === 'failed'
                          ? 'danger'
                          : !capacity || capacity.status === 'insufficient-sample'
                            ? 'warning'
                            : 'healthy'
                    }
                  >
                    {!config?.enabled
                      ? '已停用'
                      : account.lastError || capacity?.status === 'failed'
                        ? '同步异常'
                        : !capacity
                          ? '待首次同步'
                          : capacity.status === 'insufficient-sample'
                            ? '样本不足'
                            : '已同步'}
                  </StatusPill>
                </div>
              </div>
              <div className="group-allocation-table">
                <header>
                  <h3>订阅分配</h3>
                  <span>
                    {config?.shareCount ?? '—'} 等份 · 预留 {currency(capacity?.reserveUsd)} · 可分配{' '}
                    {currency(capacity?.allocatableCapacityUsd)}
                  </span>
                </header>
                {(capacity?.groups ?? []).map((group) => (
                  <div className="group-allocation-row" key={group.groupId}>
                    <CircleDot size={15} />
                    <span>
                      <strong>
                        #{group.groupId} {group.name}
                      </strong>
                      <small>分组倍率 {group.rateMultiplier}</small>
                    </span>
                    <span className="group-allocation-amount">
                      <small>原周限</small>
                      {currency(group.currentLimitUsd)}
                    </span>
                    <span className="group-allocation-amount">
                      <small>目标周限</small>
                      <strong>{currency(group.targetLimitUsd)}</strong>
                    </span>
                    <StatusPill tone={group.status === 'failed' ? 'danger' : group.updated ? 'healthy' : 'neutral'}>
                      {group.status === 'failed' ? '写入失败' : group.updated ? '已更新' : '未变化'}
                    </StatusPill>
                    {group.error && <p role="alert">{group.error}</p>}
                  </div>
                ))}
                {!capacity?.groups.length && (
                  <p className="quiet-empty">{capacity?.message ?? '等待首次分组同步快照'}</p>
                )}
              </div>
            </article>
          )
        })}
        {!accounts.length && (
          <div className="panel empty-state">
            <UsersRound size={28} />
            <strong>{dashboard.accounts.length ? '没有匹配的账号' : '还没有受管账号'}</strong>
            {dashboard.accounts.length ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('')
                  setOnlyIssues(false)
                }}
              >
                清空筛选
              </Button>
            ) : (
              <Link className="button button--primary" to="/settings">
                添加账号
              </Link>
            )}
          </div>
        )}
      </section>
      <aside className="fixed-groups">
        <ShieldOff size={20} />
        <div>
          <h3>固定排除分组</h3>
          <p>这些分组的周限不会被自动化写入。</p>
        </div>
        <div className="group-tags">
          {dashboard.config.fixedGroupIds.map((id) => (
            <span key={id}>#{id}</span>
          ))}
          {!dashboard.config.fixedGroupIds.length && <span>未设置</span>}
        </div>
      </aside>
    </>
  )
}
