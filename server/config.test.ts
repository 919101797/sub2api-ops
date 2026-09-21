// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

import { loadConfig, parseServiceConfig } from './config.js'

const valid = {
  version: 11 as const,
  fixedGroupIds: [10, 11],
  resetSync: { intervalSeconds: 180, requestTimeoutSeconds: 25, resetAtToleranceSeconds: 300, usageDropTolerancePercent: 0.5 },
  capacitySync: { intervalSeconds: 600, minimumUsedPercent: 5, minimumChangeUsd: 1 },
  promptAudit: { maxRequestBodyMiB: 10, normalRetentionDays: 30, riskRetentionDays: 60 },
  userConcurrencySchedule: {
    enabled: false,
    timezone: 'Asia/Singapore',
    peakWindows: [{ start: '11:00', end: '12:00' }, { start: '14:00', end: '17:00' }],
    peakConcurrency: 3,
    idleConcurrency: 5,
    peakRpm: 30,
    idleRpm: 40,
    exemptUserIds: [7, 9],
  },
  accounts: [
    { key: 'primary', email: 'Admin@Example.com', label: 'Primary', shareCount: 3, reserveMode: 'usd' as const, reserveValue: 140, targetGroupIds: [5, 13], enabled: true },
  ],
}

describe('parseServiceConfig', () => {
  it('normalizes email addresses and accepts the version 11 settings contract', () => {
    expect(parseServiceConfig(valid).accounts[0]?.email).toBe('admin@example.com')
    expect(parseServiceConfig(valid).accounts[0]).toMatchObject({ reserveMode: 'usd', reserveValue: 140 })
  })

  it('keeps unique positive user exemptions', () => {
    expect(parseServiceConfig(valid).userConcurrencySchedule).toEqual(valid.userConcurrencySchedule)
    expect(() => parseServiceConfig({
      ...valid,
      userConcurrencySchedule: { ...valid.userConcurrencySchedule, enabled: true, exemptUserIds: [7, 7] },
    })).toThrow(/Duplicate/)
  })

  it('accepts editable limits and rejects a peak value above the idle value', () => {
    expect(parseServiceConfig({
      ...valid,
      userConcurrencySchedule: { ...valid.userConcurrencySchedule, peakConcurrency: 2, idleConcurrency: 7 },
    }).userConcurrencySchedule).toMatchObject({ peakConcurrency: 2, idleConcurrency: 7 })
    expect(() => parseServiceConfig({
      ...valid,
      userConcurrencySchedule: { ...valid.userConcurrencySchedule, peakConcurrency: 8, idleConcurrency: 7 },
    })).toThrow(/高峰并发不能大于闲时并发/)
  })

  it('accepts only integer concurrency limits from 1 to 100', () => {
    for (const peakConcurrency of [0, 1.5, 101]) {
      expect(() => parseServiceConfig({
        ...valid,
        userConcurrencySchedule: { ...valid.userConcurrencySchedule, peakConcurrency },
      })).toThrow()
    }
  })

  it('accepts editable RPM limits and rejects an invalid peak-to-idle relationship', () => {
    expect(parseServiceConfig({
      ...valid,
      userConcurrencySchedule: { ...valid.userConcurrencySchedule, peakRpm: 24, idleRpm: 60 },
    }).userConcurrencySchedule).toMatchObject({ peakRpm: 24, idleRpm: 60 })
    expect(() => parseServiceConfig({
      ...valid,
      userConcurrencySchedule: { ...valid.userConcurrencySchedule, peakRpm: 61, idleRpm: 60 },
    })).toThrow(/高峰 RPM 不能大于闲时 RPM/)
    for (const peakRpm of [0, 1.5, 10_001]) {
      expect(() => parseServiceConfig({
        ...valid,
        userConcurrencySchedule: { ...valid.userConcurrencySchedule, peakRpm },
      })).toThrow()
    }
  })

  it('接受有效 IANA 时区与 1–4 个不重叠高峰时段', () => {
    expect(parseServiceConfig({
      ...valid,
      userConcurrencySchedule: {
        ...valid.userConcurrencySchedule,
        timezone: 'America/New_York',
        peakWindows: [{ start: '08:30', end: '10:15' }],
      },
    }).userConcurrencySchedule).toMatchObject({
      timezone: 'America/New_York',
      peakWindows: [{ start: '08:30', end: '10:15' }],
    })

    for (const change of [
      { timezone: 'Singapore Time' },
      { peakWindows: [] },
      { peakWindows: [{ start: '12:00', end: '11:00' }] },
      { peakWindows: [{ start: '11:00', end: '12:00' }, { start: '11:30', end: '13:00' }] },
    ]) {
      expect(() => parseServiceConfig({
        ...valid,
        userConcurrencySchedule: { ...valid.userConcurrencySchedule, ...change },
      })).toThrow()
    }
  })

  it('场景-004-05：keeps reserve modes and values independent between managed accounts', () => {
    const parsed = parseServiceConfig({
      ...valid,
      accounts: [
        valid.accounts[0],
        { ...valid.accounts[0], key: 'secondary', email: 'secondary@example.com', reserveMode: 'percent' as const, reserveValue: 12.5, targetGroupIds: [6] },
      ],
    })
    expect(parsed.accounts.map((account) => [account.reserveMode, account.reserveValue])).toEqual([['usd', 140], ['percent', 12.5]])
  })

  it('rejects reserve values outside the selected mode range', () => {
    expect(() => parseServiceConfig({
      ...valid,
      accounts: [{ ...valid.accounts[0], reserveMode: 'percent', reserveValue: 100.01 }],
    })).toThrow(/百分比/)
    expect(() => parseServiceConfig({
      ...valid,
      accounts: [{ ...valid.accounts[0], reserveMode: 'usd', reserveValue: 1_000_000.01 }],
    })).toThrow()
  })

  it('rejects risk retention shorter than normal retention', () => {
    expect(() => parseServiceConfig({
      ...valid,
      promptAudit: { maxRequestBodyMiB: 10, normalRetentionDays: 30, riskRetentionDays: 7 },
    })).toThrow(/风险记录保留时间不能短于正常记录/)
  })

  it('accepts only a 1 to 16 MiB prompt audit body limit', () => {
    expect(parseServiceConfig(valid).promptAudit.maxRequestBodyMiB).toBe(10)
    expect(() => parseServiceConfig({
      ...valid,
      promptAudit: { ...valid.promptAudit, maxRequestBodyMiB: 17 },
    })).toThrow()
  })

  it('rejects fixed groups as capacity targets', () => {
    expect(() => parseServiceConfig({
      ...valid,
      accounts: [{ ...valid.accounts[0]!, targetGroupIds: [10] }],
    })).toThrow(/fixed/)
  })

  it('rejects a group assigned to more than one account', () => {
    expect(() => parseServiceConfig({
      ...valid,
      accounts: [valid.accounts[0], { ...valid.accounts[0], key: 'secondary', email: 'secondary@example.com' }],
    })).toThrow(/already assigned/)
  })
})

// The distributed example must be loadable without enabling upstream writes.
it('场景-004-06：分发配置可加载且默认关闭自动化', async () => {
  const config = await loadConfig(fileURLToPath(new URL('../config.example.json', import.meta.url)))
  expect(config.version).toBe(11)
  expect(config.accounts.length).toBeGreaterThan(0)
  expect(config.accounts.every((account) => !account.enabled && account.email.endsWith('@example.com'))).toBe(true)
  expect(config.userConcurrencySchedule.enabled).toBe(false)
  expect(config.userConcurrencySchedule.exemptUserIds).toEqual([])
})
