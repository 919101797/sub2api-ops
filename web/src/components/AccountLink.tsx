import { useState } from 'react'
import { ArrowRight, ChevronDown, Wifi, Server } from 'lucide-react'
import type { AccountInfrastructure, AccountRuntime } from '@shared/contracts'
import { AccountAnalyticsPanel } from './AccountAnalyticsPanel'
import { ResetCyclePanel } from './ResetCyclePanel'
import { StatusPill } from './ui'
import { Disclosure } from './Disclosure'
import { currency, percent } from '@/lib/format'

export function AccountLink({
  account,
  infrastructure,
}: {
  account: AccountRuntime
  infrastructure?: AccountInfrastructure
}) {
  const [expanded, setExpanded] = useState(false)
  const capacity = account.capacity
  const proxy = infrastructure?.proxy
  const panelId = `account-details-${account.key}`
  return (
    <article className={`account-link${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="account-link__row"
        aria-label={`${expanded ? '收起' : '展开'} ${account.label} 的周期与用量`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="account-link__identity">
          <span className="account-monogram">{account.label.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{account.label}</strong>
            <small>{account.email}</small>
          </span>
        </span>
        <span className="account-link__connector" aria-hidden="true">
          <i />
          <ArrowRight size={15} />
        </span>
        <span className="account-link__proxy">
          <span className="proxy-icon">
            <Wifi size={19} aria-hidden="true" />
          </span>
          <span>
            <strong>{proxy?.name ?? '未绑定家宽'}</strong>
            <small>{proxy ? `${proxy.protocol} · ${proxy.endpoint}` : (infrastructure?.error ?? '等待关联信息')}</small>
          </span>
        </span>
        <span className="account-link__quota">
          <small>周限 / 每份容量</small>
          <strong>
            {percent(capacity?.usedPercent)}
            <i> / </i>
            {currency(capacity?.perShareCapacityUsd)}
          </strong>
        </span>
        <StatusPill tone={account.lastError ? 'danger' : proxy?.status === 'active' ? 'healthy' : 'neutral'}>
          {account.lastError ? '账号异常' : proxy?.status === 'active' ? '出口在线' : proxy ? proxy.status : '未配置'}
        </StatusPill>
        <ChevronDown size={17} className="account-link__chevron" aria-hidden="true" />
      </button>
      {account.lastError && (
        <p className="account-link__error" role="alert">
          {account.lastError}
        </p>
      )}
      <Disclosure open={expanded} id={panelId}>
        <div className="account-link__allocations">
          <span>
            <Server size={14} />
            订阅分组
          </span>
          {(capacity?.groups ?? []).map((group) => (
            <span className="allocation-chip" key={group.groupId}>
              #{group.groupId} {group.name}
              <b>{currency(group.targetLimitUsd)}</b>
            </span>
          ))}
          {!capacity?.groups.length && <small>等待首次容量同步</small>}
        </div>
        <ResetCyclePanel account={account} />
        <AccountAnalyticsPanel account={account} />
      </Disclosure>
    </article>
  )
}
