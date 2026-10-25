import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { ResourcesPage } from './ResourcesPage'
import { api } from '@/lib/api'
vi.mock('@/components/RuntimeSettingsPanel', () => ({ RuntimeSettingsPanel: () => null }))
vi.mock('@/lib/api', () => ({ api: { resources: vi.fn() } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('场景-011-04/05：区分采样中断和资源零值，保留历史查询入口', async () => {
  vi.mocked(api.resources).mockResolvedValue({ generatedAt: new Date().toISOString(), firstRecordedAt: null,
    sampleIntervalSeconds: 15, retentionDays: 7, bucketSeconds: 15, sampleCount: 0, stale: true, latest: null, points: [] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ResourcesPage /></QueryClientProvider>)
  expect(await screen.findByRole('alert')).toHaveTextContent('采样中断')
  expect(screen.getByText('此时段暂无采样记录')).toBeInTheDocument()
  expect(screen.getByLabelText('开始时间')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '7 天' }))
  expect(await screen.findByText('15 秒采样 · 保留 7 天')).toBeInTheDocument()
})
it('场景-011-04：首个磁盘速率未知时不显示零，并提供容器总内存', async () => {
  vi.mocked(api.resources).mockResolvedValue({ generatedAt: new Date().toISOString(), firstRecordedAt: null,
    sampleIntervalSeconds: 15, retentionDays: 7, bucketSeconds: 15, sampleCount: 1, stale: false, points: [],
    latest: { at: new Date().toISOString(), bootId: 'boot', containers: [],
      host: { totalBytes: 2000, availableBytes: 1000, swapTotalBytes: 4000, swapUsedBytes: 0, swapInBytesPerSecond: null, swapOutBytesPerSecond: null },
      disks: [{ device: 'vda', readAwaitMs: null, writeAwaitMs: null, busyPercent: null }] } })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ResourcesPage /></QueryClientProvider>)
  await screen.findByText('独立采样运行中')
  const metrics = within(screen.getByLabelText('当前宿主机资源'))
  expect(metrics.queryByText('0.0 ms')).not.toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: '当前总内存' })).toBeInTheDocument()
})
