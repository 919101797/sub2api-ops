import { SelectionRail, SelectionIndicator } from '../components/SelectionRail'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarX2,
  Clock3,
  Database,
  Eraser,
  Gauge,
  Globe2,
  HardDrive,
  Image,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import Select, { type MultiValue, type SingleValue } from 'react-select'

import type { AccountConfig, DashboardResponse, ServiceConfig, SettingsOptionsResponse } from '@shared/contracts'
import { Button, PageHeading } from '@/components/ui'
import { ConfirmDialog } from '@/components/Dialog'
import { api } from '@/lib/api'
import { dateTime, fileSize } from '@/lib/format'

function emptyAccount(index: number): AccountConfig {
  return {
    key: `account-${index}`,
    email: '',
    label: '新 OpenAI 账号',
    shareCount: 3,
    reserveMode: 'usd',
    reserveValue: 0,
    targetGroupIds: [],
    enabled: true,
  }
}

interface AccountOption {
  value: string
  label: string
  status: SettingsOptionsResponse['accounts'][number]['status']
}

interface GroupOption {
  value: number
  label: string
  isDisabled?: boolean
}

interface UserOption {
  value: number
  label: string
  status: SettingsOptionsResponse['users'][number]['status']
}

interface TimezoneOption {
  value: string
  label: string
}

const portalStyles = { menuPortal: (base: Record<string, unknown>) => ({ ...base, zIndex: 60 }) }
const timezoneOptions: TimezoneOption[] = [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].map(
  (timezone) => ({ value: timezone, label: timezone }),
)

function currentLocalDateTime(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function selectedAccountOption(email: string, options: AccountOption[]): AccountOption | null {
  if (!email) return null
  return (
    options.find((option) => option.value.toLowerCase() === email.toLowerCase()) ?? {
      value: email,
      label: `${email} · 当前配置`,
      status: 'error',
    }
  )
}

function selectedGroupOptions(groupIds: number[], options: GroupOption[]): GroupOption[] {
  return groupIds.map(
    (groupId) =>
      options.find((option) => option.value === groupId) ?? {
        value: groupId,
        label: `#${groupId} · 当前配置`,
      },
  )
}

function selectedUserOptions(userIds: number[], options: UserOption[]): UserOption[] {
  return userIds.map(
    (userId) =>
      options.find((option) => option.value === userId) ?? {
        value: userId,
        label: `#${userId} · 当前配置`,
        status: 'disabled',
      },
  )
}

function selectedTimezoneOption(timezone: string): TimezoneOption {
  return timezoneOptions.find((option) => option.value === timezone) ?? { value: timezone, label: timezone }
}

export function SettingsPage({ dashboard }: { dashboard: DashboardResponse }) {
  const [activeTab, setActiveTab] = useState('accounts')
  const [savedConfig, setSavedConfig] = useState(() => structuredClone(dashboard.config))
  const [purgeTarget, setPurgeTarget] = useState<'all' | 'before' | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [draft, setDraft] = useState<ServiceConfig>(() => structuredClone(dashboard.config))
  const [purgeBefore, setPurgeBefore] = useState('')
  const [purgeNotice, setPurgeNotice] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const settingsOptions = useQuery({
    queryKey: ['settings-options'],
    queryFn: api.settingsOptions,
    staleTime: 60_000,
  })
  const storage = useQuery({
    queryKey: ['prompt-storage'],
    queryFn: api.promptStorage,
    staleTime: 30_000,
  })
  const save = useMutation({
    mutationFn: api.saveConfig,
    onSuccess: (config) => {
      setDraft(structuredClone(config))
      setSavedConfig(structuredClone(config))
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['prompt-storage'] })
    },
  })
  const purge = useMutation({
    mutationFn: api.purgePrompts,
    onSuccess: async (result) => {
      setPurgeNotice(
        `已删除 ${result.deletedRecords.toLocaleString('zh-CN')} 条审计记录和 ${result.deletedImages.toLocaleString('zh-CN')} 张图片，释放图片文件 ${fileSize(result.freedImageBytes)}。`,
      )
      setPurgeBefore('')
      setPurgeTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['prompt-storage'] }),
        queryClient.invalidateQueries({ queryKey: ['prompts'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ])
    },
  })
  const changeAccount = (index: number, change: Partial<AccountConfig>) =>
    setDraft((current) => ({
      ...current,
      accounts: current.accounts.map((account, accountIndex) =>
        accountIndex === index ? { ...account, ...change } : account,
      ),
    }))
  const changeConcurrencySchedule = (change: Partial<ServiceConfig['userConcurrencySchedule']>) =>
    setDraft((current) => ({
      ...current,
      userConcurrencySchedule: { ...current.userConcurrencySchedule, ...change },
    }))
  const changePeakWindow = (
    index: number,
    change: Partial<ServiceConfig['userConcurrencySchedule']['peakWindows'][number]>,
  ) =>
    setDraft((current) => ({
      ...current,
      userConcurrencySchedule: {
        ...current.userConcurrencySchedule,
        peakWindows: current.userConcurrencySchedule.peakWindows.map((window, windowIndex) =>
          windowIndex === index ? { ...window, ...change } : window,
        ),
      },
    }))
  const addPeakWindow = () =>
    changeConcurrencySchedule({
      peakWindows: [...draft.userConcurrencySchedule.peakWindows, { start: '18:00', end: '19:00' }],
    })
  const removePeakWindow = (index: number) =>
    changeConcurrencySchedule({
      peakWindows: draft.userConcurrencySchedule.peakWindows.filter((_, windowIndex) => windowIndex !== index),
    })
  const accountOptions: AccountOption[] = (settingsOptions.data?.accounts ?? []).map((account) => ({
    value: account.email,
    label: `${account.email} · ID ${account.id}${account.status === 'active' ? '' : ` · ${account.status}`}`,
    status: account.status,
  }))
  const groupOptions: GroupOption[] = (settingsOptions.data?.groups ?? []).map((group) => ({
    value: group.id,
    label: `#${group.id} · ${group.name}${group.weeklyLimitUsd === null ? '' : ` · $${group.weeklyLimitUsd}`}`,
  }))
  const userOptions: UserOption[] = (settingsOptions.data?.users ?? []).map((user) => ({
    value: user.id,
    label: `${user.email} · ${user.username} · ${user.concurrency} 并发 · ${user.rpmLimit === 0 ? 'RPM 不限' : `${user.rpmLimit} RPM`}${user.status === 'active' ? '' : ' · 已停用'}`,
    status: user.status,
  }))
  const assignedGroupIds = new Set(draft.accounts.flatMap((account) => account.targetGroupIds))
  const purgeBeforeIso = purgeBefore ? new Date(purgeBefore).toISOString() : ''
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedConfig)
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  const submitConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const invalid = [
      ...event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'),
    ].find((input) => !input.checkValidity())
    if (invalid) {
      setActiveTab(invalid.closest<HTMLElement>('[data-settings-panel]')!.dataset.settingsPanel!)
      requestAnimationFrame(() => {
        invalid.reportValidity()
        invalid.focus()
      })
      return
    }
    save.mutate(draft)
  }
  const settingsTabs = [
    { key: 'accounts', label: '账号与分组' },
    { key: 'sync', label: '同步参数' },
    { key: 'concurrency', label: '峰谷策略' },
    { key: 'storage', label: '内容与存储' },
  ]
  const confirmPurgeBefore = () => {
    purge.reset()
    setPurgeTarget('before')
  }
  const confirmPurgeAll = () => {
    purge.reset()
    setPurgeTarget('all')
  }

  return (
    <>
      <PageHeading
        title="系统设置"
        actions={
          <div className="settings-save-actions">
            <span className={dirty ? 'draft-status is-dirty' : 'draft-status'}>
              {dirty ? '有未保存的更改' : '配置已同步'}
            </span>
            <Button type="submit" form="settings-form" busy={save.isPending} disabled={!dirty}>
              <Save size={16} aria-hidden="true" />
              保存配置
            </Button>
          </div>
        }
      />
      {save.isSuccess && (
        <div className="save-notice" role="status">
          配置已生效，下一轮同步将使用新参数。
        </div>
      )}
      {save.error && (
        <div className="form-error" role="alert">
          {save.error.message}
        </div>
      )}
      {settingsOptions.error && (
        <div className="form-error" role="alert">
          无法读取 sub2api 账号、用户与分组列表：{settingsOptions.error.message}
        </div>
      )}

      <SelectionRail variant="line" className="settings-tabs" role="tablist" aria-label="设置分类">
        {settingsTabs.map((tab, index) => (
          <button
            key={tab.key}
            id={`settings-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`settings-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % settingsTabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + settingsTabs.length - 1) % settingsTabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? settingsTabs.length - 1
                        : null
              if (next === null) return
              event.preventDefault()
              setActiveTab(settingsTabs[next]!.key)
              document.getElementById(`settings-tab-${settingsTabs[next]!.key}`)?.focus()
            }}
          >
            <SelectionIndicator active={activeTab === tab.key} />{tab.label}
          </button>
        ))}
      </SelectionRail>
      <form ref={formRef} id="settings-form" noValidate onSubmit={submitConfig}>
        <fieldset className="settings-form-fields" disabled={save.isPending}>
          <section
            id="settings-panel-storage"
            data-settings-panel="storage"
            role="tabpanel"
            aria-labelledby="settings-tab-storage"
            hidden={activeTab !== 'storage'}
            className="settings-section audit-storage-settings"
          >
            <header>
              <h2>内容留存与服务器空间</h2>
              <Button variant="secondary" busy={storage.isFetching} onClick={() => void storage.refetch()}>
                <RefreshCw size={14} aria-hidden="true" />
                刷新统计
              </Button>
            </header>
            {storage.error && (
              <div className="form-error" role="alert">
                无法读取审计存储统计：{storage.error.message}
              </div>
            )}
            <div className="audit-storage-metrics">
              <article>
                <Database size={17} aria-hidden="true" />
                <span>审计日志</span>
                <strong>{storage.data?.logs.records.toLocaleString('zh-CN') ?? '—'} 条</strong>
                <small>PostgreSQL 实际占用 {fileSize(storage.data?.logs.databaseBytes)}</small>
              </article>
              <article>
                <Image size={17} aria-hidden="true" />
                <span>持久化图片</span>
                <strong>{storage.data?.images.files.toLocaleString('zh-CN') ?? '—'} 张</strong>
                <small>宿主机目录占用 {fileSize(storage.data?.images.bytes)}</small>
              </article>
              <article>
                <HardDrive size={17} aria-hidden="true" />
                <span>总体空间</span>
                <strong>{fileSize(storage.data?.totalBytes)}</strong>
                <small>日志表与图片文件合计</small>
              </article>
              <article>
                <CalendarX2 size={17} aria-hidden="true" />
                <span>手动清理界限</span>
                <strong>
                  {storage.data && Date.parse(storage.data.purgeBefore) > 86_400_000
                    ? dateTime(storage.data.purgeBefore)
                    : '尚未执行'}
                </strong>
                <small>更早的 sub2api 摘要也不再展示</small>
              </article>
            </div>
            <div className="audit-retention-grid">
              <label>
                <span>单次审计正文上限（MiB）</span>
                <input
                  type="number"
                  min="1"
                  max="16"
                  step="1"
                  value={draft.promptAudit.maxRequestBodyMiB}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      promptAudit: { ...draft.promptAudit, maxRequestBodyMiB: Number(event.target.value) },
                    })
                  }
                />
                <small>只审计声明大小不超过此值的 HTTP 请求和 WebSocket 消息；超限或大小未知时直接跳过正文。</small>
              </label>
              <label>
                <span>正常记录与图片保留（天）</span>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={draft.promptAudit.normalRetentionDays}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      promptAudit: { ...draft.promptAudit, normalRetentionDays: Number(event.target.value) },
                    })
                  }
                />
                <small>从每条消息的创建时间起计算，不因查看或统计周期延长</small>
              </label>
              <label>
                <span>风险记录与图片保留（天）</span>
                <input
                  type="number"
                  min={draft.promptAudit.normalRetentionDays}
                  max="3650"
                  value={draft.promptAudit.riskRetentionDays}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      promptAudit: { ...draft.promptAudit, riskRetentionDays: Number(event.target.value) },
                    })
                  }
                />
                <small>同样从消息创建时间起计算；系统每天清理到期记录</small>
              </label>
              <div className="audit-purge-before">
                <label>
                  <span>删除此日期时间之前的数据</span>
                  <input
                    type="datetime-local"
                    step="60"
                    value={purgeBefore}
                    max={currentLocalDateTime()}
                    onChange={(event) => setPurgeBefore(event.target.value)}
                  />
                </label>
                <Button
                  variant="secondary"
                  busy={purge.isPending && purge.variables?.scope === 'before'}
                  disabled={!purgeBefore}
                  onClick={confirmPurgeBefore}
                >
                  <CalendarX2 size={14} aria-hidden="true" />
                  按日期删除
                </Button>
              </div>
              <div className="audit-purge-all">
                <div>
                  <strong>清空全部审计数据</strong>
                  <span>永久删除全部完整提示词和图片；sub2api 原始风控表不会被修改。</span>
                </div>
                <Button
                  variant="danger"
                  disabled={purge.isPending}
                  busy={purge.isPending && purge.variables?.scope === 'all'}
                  onClick={confirmPurgeAll}
                >
                  <Eraser size={14} aria-hidden="true" />
                  清空全部
                </Button>
              </div>
            </div>
            {purgeNotice && (
              <div className="save-notice" role="status">
                {purgeNotice}
              </div>
            )}
            {purge.error && (
              <div className="form-error" role="alert">
                清理失败：{purge.error.message}
              </div>
            )}
          </section>

          <section
            id="settings-panel-accounts"
            data-settings-panel="accounts"
            role="tabpanel"
            aria-labelledby="settings-tab-accounts"
            hidden={activeTab !== 'accounts'}
            className="settings-section"
          >
            <header>
              <h2>受管 OpenAI 账号</h2>
              <Button
                variant="secondary"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    accounts: [...current.accounts, emptyAccount(current.accounts.length + 1)],
                  }))
                }
              >
                <Plus size={15} aria-hidden="true" />
                添加账号
              </Button>
            </header>
            <div className="account-settings-list">
              {draft.accounts.map((account, index) => (
                <fieldset key={`${account.key}-${index}`} className="account-settings">
                  <legend>账号 {String(index + 1).padStart(2, '0')}</legend>
                  <label className="span-2">
                    <span>显示名称</span>
                    <input
                      value={account.label}
                      onChange={(event) => changeAccount(index, { label: event.target.value })}
                      required
                    />
                  </label>
                  <label className="span-2">
                    <span>OpenAI 账号</span>
                    <Select<AccountOption, false>
                      className="config-select"
                      classNamePrefix="ops-select"
                      value={selectedAccountOption(account.email, accountOptions)}
                      options={accountOptions}
                      onChange={(option: SingleValue<AccountOption>) =>
                        option && changeAccount(index, { email: option.value })
                      }
                      isOptionDisabled={(option) =>
                        (option.status !== 'active' && option.value !== account.email) ||
                        draft.accounts.some(
                          (candidate, candidateIndex) =>
                            candidateIndex !== index && candidate.email.toLowerCase() === option.value.toLowerCase(),
                        )
                      }
                      isLoading={settingsOptions.isLoading}
                      isSearchable
                      menuPosition="fixed"
                      menuPortalTarget={document.body}
                      styles={portalStyles}
                      placeholder="搜索 OpenAI 账号或 ID"
                      noOptionsMessage={() => '没有可用的 OpenAI 账号'}
                      loadingMessage={() => '正在读取账号…'}
                      aria-label={`账号 ${index + 1} 的 OpenAI 账号`}
                    />
                  </label>
                  <label>
                    <span>稳定标识</span>
                    <input
                      value={account.key}
                      pattern="[a-z0-9-]+"
                      onChange={(event) => changeAccount(index, { key: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    <span>分配份数</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={account.shareCount}
                      onChange={(event) => changeAccount(index, { shareCount: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>预留不分配</span>
                    <div className="reserve-input">
                      <input
                        aria-label={`账号 ${index + 1} 的预留值`}
                        type="number"
                        min="0"
                        max={account.reserveMode === 'percent' ? 100 : 1_000_000}
                        step="0.01"
                        value={account.reserveValue}
                        onChange={(event) => changeAccount(index, { reserveValue: Number(event.target.value) })}
                      />
                      <select
                        aria-label={`账号 ${index + 1} 的预留单位`}
                        value={account.reserveMode}
                        onChange={(event) => {
                          const reserveMode = event.target.value as AccountConfig['reserveMode']
                          changeAccount(index, {
                            reserveMode,
                            reserveValue:
                              reserveMode === 'percent' ? Math.min(100, account.reserveValue) : account.reserveValue,
                          })
                        }}
                      >
                        <option value="usd">USD</option>
                        <option value="percent">百分比</option>
                      </select>
                    </div>
                    <small>
                      {account.reserveMode === 'percent'
                        ? '按该账号整周期估算额度的百分比预留。'
                        : '从该账号的整周期估算额度中扣除固定金额。'}
                    </small>
                  </label>
                  <label className="span-2">
                    <span>目标分组</span>
                    <Select<GroupOption, true>
                      className="config-select"
                      classNamePrefix="ops-select"
                      value={selectedGroupOptions(account.targetGroupIds, groupOptions)}
                      options={groupOptions.map((option) => ({
                        ...option,
                        isDisabled:
                          draft.fixedGroupIds.includes(option.value) ||
                          draft.accounts.some(
                            (candidate, candidateIndex) =>
                              candidateIndex !== index && candidate.targetGroupIds.includes(option.value),
                          ),
                      }))}
                      onChange={(options: MultiValue<GroupOption>) =>
                        changeAccount(index, { targetGroupIds: options.map((option) => option.value) })
                      }
                      isOptionDisabled={(option) => Boolean(option.isDisabled)}
                      isLoading={settingsOptions.isLoading}
                      isMulti
                      isSearchable
                      closeMenuOnSelect={false}
                      menuPosition="fixed"
                      menuPortalTarget={document.body}
                      styles={portalStyles}
                      placeholder="搜索并选择分组"
                      noOptionsMessage={() => '没有可用分组'}
                      loadingMessage={() => '正在读取分组…'}
                      aria-label={`账号 ${index + 1} 的目标分组`}
                    />
                  </label>
                  <label className="toggle-field span-2">
                    <input
                      type="checkbox"
                      checked={account.enabled}
                      onChange={(event) => changeAccount(index, { enabled: event.target.checked })}
                    />
                    <span>
                      <strong>启用自动化</strong>
                      <small>禁用后保留历史状态，但不再查询或写入。</small>
                    </span>
                  </label>
                  <Button
                    variant="quiet"
                    className="account-delete"
                    disabled={draft.accounts.length <= 1}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        accounts: current.accounts.filter((_, accountIndex) => accountIndex !== index),
                      }))
                    }
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    删除
                  </Button>
                </fieldset>
              ))}
            </div>
          </section>

          <section
            id="settings-panel-concurrency"
            data-settings-panel="concurrency"
            role="tabpanel"
            aria-labelledby="settings-tab-concurrency"
            hidden={activeTab !== 'concurrency'}
            className="settings-section concurrency-policy"
          >
            <header>
              <div>
                <h2>用户峰谷限流策略</h2>
                <p>在业务高峰收紧 Sub2API 用户并发与 RPM，闲时自动恢复。</p>
              </div>
              <span className={`policy-state ${draft.userConcurrencySchedule.enabled ? 'policy-state--enabled' : ''}`}>
                {draft.userConcurrencySchedule.enabled ? '策略已开启' : '策略已关闭'}
              </span>
            </header>
            <div className="concurrency-policy__body">
              <div className="concurrency-policy__control">
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={draft.userConcurrencySchedule.enabled}
                    onChange={(event) => changeConcurrencySchedule({ enabled: event.target.checked })}
                  />
                  <span>
                    <strong>启用自动峰谷策略</strong>
                    <small>关闭并保存后，活跃用户会立即恢复为闲时的并发与 RPM 上限。</small>
                  </span>
                </label>
                <label className="concurrency-policy__timezone">
                  <span>
                    <Globe2 size={15} aria-hidden="true" />
                    策略时区
                  </span>
                  <Select<TimezoneOption, false>
                    className="config-select"
                    classNamePrefix="ops-select"
                    value={selectedTimezoneOption(draft.userConcurrencySchedule.timezone)}
                    options={timezoneOptions}
                    onChange={(option: SingleValue<TimezoneOption>) =>
                      option && changeConcurrencySchedule({ timezone: option.value })
                    }
                    isSearchable
                    menuPosition="fixed"
                    menuPortalTarget={document.body}
                    styles={portalStyles}
                    aria-label="峰谷策略时区"
                  />
                  <small>高峰时段按该时区计算，不读取服务器时区。</small>
                </label>
                <div className="concurrency-policy__rules">
                  <article className="concurrency-policy__peak-rule">
                    <Clock3 size={16} aria-hidden="true" />
                    <div>
                      <span>工作日高峰</span>
                      <div className="peak-window-list">
                        {draft.userConcurrencySchedule.peakWindows.map((window, index) => (
                          <div className="peak-window" key={index}>
                            <label>
                              <span className="sr-only">{`高峰时段 ${index + 1} 开始`}</span>
                              <input
                                aria-label={`高峰时段 ${index + 1} 开始`}
                                type="time"
                                value={window.start}
                                onChange={(event) => changePeakWindow(index, { start: event.target.value })}
                              />
                            </label>
                            <span>至</span>
                            <label>
                              <span className="sr-only">{`高峰时段 ${index + 1} 结束`}</span>
                              <input
                                aria-label={`高峰时段 ${index + 1} 结束`}
                                type="time"
                                value={window.end}
                                onChange={(event) => changePeakWindow(index, { end: event.target.value })}
                              />
                            </label>
                            <button
                              type="button"
                              aria-label={`删除高峰时段 ${index + 1}`}
                              disabled={draft.userConcurrencySchedule.peakWindows.length === 1}
                              onClick={() => removePeakWindow(index)}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                      {draft.userConcurrencySchedule.peakWindows.length < 4 && (
                        <button className="peak-window-add" type="button" onClick={addPeakWindow}>
                          <Plus size={13} aria-hidden="true" />
                          添加高峰时段
                        </button>
                      )}
                      <label className="concurrency-limit">
                        <span>并发上限</span>
                        <input
                          aria-label="高峰并发上限"
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          value={draft.userConcurrencySchedule.peakConcurrency}
                          onChange={(event) =>
                            changeConcurrencySchedule({ peakConcurrency: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label className="concurrency-limit">
                        <span>RPM 上限</span>
                        <input
                          aria-label="高峰 RPM 上限"
                          type="number"
                          min="1"
                          max="10000"
                          step="1"
                          value={draft.userConcurrencySchedule.peakRpm}
                          onChange={(event) => changeConcurrencySchedule({ peakRpm: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  </article>
                  <article>
                    <Gauge size={16} aria-hidden="true" />
                    <div>
                      <span>闲时与假日</span>
                      <strong>其他时间 · 周末 · 中国法定节假日</strong>
                      <label className="concurrency-limit">
                        <span>并发上限</span>
                        <input
                          aria-label="闲时并发上限"
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          value={draft.userConcurrencySchedule.idleConcurrency}
                          onChange={(event) =>
                            changeConcurrencySchedule({ idleConcurrency: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label className="concurrency-limit">
                        <span>RPM 上限</span>
                        <input
                          aria-label="闲时 RPM 上限"
                          type="number"
                          min="1"
                          max="10000"
                          step="1"
                          value={draft.userConcurrencySchedule.idleRpm}
                          onChange={(event) => changeConcurrencySchedule({ idleRpm: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  </article>
                </div>
              </div>
              <label className="concurrency-policy__exemptions">
                <span>
                  <ShieldCheck size={15} aria-hidden="true" />
                  豁免用户
                </span>
                <Select<UserOption, true>
                  className="config-select"
                  classNamePrefix="ops-select"
                  value={selectedUserOptions(draft.userConcurrencySchedule.exemptUserIds, userOptions)}
                  options={userOptions}
                  onChange={(options: MultiValue<UserOption>) =>
                    changeConcurrencySchedule({ exemptUserIds: options.map((option) => option.value) })
                  }
                  isLoading={settingsOptions.isLoading}
                  isMulti
                  isSearchable
                  closeMenuOnSelect={false}
                  menuPosition="fixed"
                  menuPortalTarget={document.body}
                  styles={portalStyles}
                  placeholder="搜索邮箱或用户名"
                  noOptionsMessage={() => '没有可选用户'}
                  loadingMessage={() => '正在读取用户…'}
                  aria-label="峰谷策略豁免用户"
                />
                <small>豁免用户始终使用闲时并发，RPM 不限。停用用户不会被写入。</small>
              </label>
            </div>
          </section>

          <section
            id="settings-panel-sync"
            data-settings-panel="sync"
            role="tabpanel"
            aria-labelledby="settings-tab-sync"
            hidden={activeTab !== 'sync'}
            className="settings-grid"
          >
            <article className="settings-section compact-settings">
              <header>
                <h2>容量估算</h2>
              </header>
              <label>
                <span>运行间隔（秒）</span>
                <input
                  type="number"
                  min="60"
                  value={draft.capacitySync.intervalSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      capacitySync: { ...draft.capacitySync, intervalSeconds: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                <span>最低可估算使用率（%）</span>
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={draft.capacitySync.minimumUsedPercent}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      capacitySync: { ...draft.capacitySync, minimumUsedPercent: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                <span>最小写入变化（USD）</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.capacitySync.minimumChangeUsd}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      capacitySync: { ...draft.capacitySync, minimumChangeUsd: Number(event.target.value) },
                    })
                  }
                />
              </label>
            </article>
            <article className="settings-section compact-settings">
              <header>
                <h2>周期重置</h2>
              </header>
              <label>
                <span>运行间隔（秒）</span>
                <input
                  type="number"
                  min="30"
                  value={draft.resetSync.intervalSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      resetSync: { ...draft.resetSync, intervalSeconds: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                <span>reset_at 容差（秒）</span>
                <input
                  type="number"
                  min="0"
                  value={draft.resetSync.resetAtToleranceSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      resetSync: { ...draft.resetSync, resetAtToleranceSeconds: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                <span>用量下降容差（%）</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={draft.resetSync.usageDropTolerancePercent}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      resetSync: { ...draft.resetSync, usageDropTolerancePercent: Number(event.target.value) },
                    })
                  }
                />
              </label>
            </article>
            <article className="settings-section compact-settings">
              <header>
                <h2>固定排除</h2>
              </header>
              <label>
                <span>不写入的分组</span>
                <Select<GroupOption, true>
                  className="config-select"
                  classNamePrefix="ops-select"
                  value={selectedGroupOptions(draft.fixedGroupIds, groupOptions)}
                  options={groupOptions.map((option) => ({
                    ...option,
                    isDisabled: assignedGroupIds.has(option.value),
                  }))}
                  onChange={(options: MultiValue<GroupOption>) =>
                    setDraft({ ...draft, fixedGroupIds: options.map((option) => option.value) })
                  }
                  isOptionDisabled={(option) => Boolean(option.isDisabled)}
                  isLoading={settingsOptions.isLoading}
                  isMulti
                  isSearchable
                  closeMenuOnSelect={false}
                  menuPosition="fixed"
                  menuPortalTarget={document.body}
                  styles={portalStyles}
                  placeholder="搜索并选择排除分组"
                  noOptionsMessage={() => '没有可用分组'}
                  loadingMessage={() => '正在读取分组…'}
                  aria-label="不写入的分组"
                />
              </label>
              <label>
                <span>请求超时（秒）</span>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={draft.resetSync.requestTimeoutSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      resetSync: { ...draft.resetSync, requestTimeoutSeconds: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <p className="settings-note">排除只阻止分组周限被写入；账号上已产生的流量仍用于估算整个周期的容量。</p>
            </article>
          </section>
        </fieldset>
      </form>
      {dirty && (
        <div className="settings-draft-bar">
          <span>更改将在保存后生效</span>
          <Button
            variant="quiet"
            disabled={save.isPending}
            onClick={() => {
              setDraft(structuredClone(savedConfig))
              save.reset()
            }}
          >
            撤销更改
          </Button>
        </div>
      )}
      {purgeTarget && (
        <ConfirmDialog
          title={purgeTarget === 'all' ? '清空全部审计数据' : '按日期清理审计数据'}
          message={
            purgeTarget === 'all'
              ? '全部完整提示词和图片将被永久删除，无法恢复。Sub2API 原始风控表不会被修改。'
              : `永久删除 ${dateTime(purgeBeforeIso)} 之前的全部审计记录和图片。此操作无法恢复。`
          }
          confirmLabel="确认删除"
          {...(purgeTarget === 'all' ? { confirmation: '清空全部' } : {})}
          busy={purge.isPending}
          {...(purge.error ? { error: purge.error.message } : {})}
          onClose={() => setPurgeTarget(null)}
          onConfirm={() => {
            if (purge.isPending) return
            setPurgeNotice(null)
            purge.mutate(purgeTarget === 'all' ? { scope: 'all' } : { scope: 'before', before: purgeBeforeIso })
          }}
        />
      )}
    </>
  )
}
