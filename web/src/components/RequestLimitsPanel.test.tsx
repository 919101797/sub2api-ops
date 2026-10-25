import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { RequestLimitsPanel } from './RequestLimitsPanel'
import { api } from '@/lib/api'
vi.mock('@/lib/api', () => ({ api: { requestLimits: vi.fn(), saveRequestLimits: vi.fn() } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('场景-012-04：管理员编辑默认值、用户例外和通道数，独立保存并保留冲突草稿', async () => {
  const data = { revision: 'a'.repeat(64), policy: { version: 1 as const, defaultMaxMiB: 30, largeThresholdMiB: 30, maxLargeConcurrent: 1, userOverrides: [{ userId: 1, maxMiB: 70 }], updatedAt: '2026-10-24T00:00:00Z', updatedBy: 'admin' } }
  vi.mocked(api.requestLimits).mockResolvedValue(data)
  vi.mocked(api.saveRequestLimits).mockImplementation(async input => ({ revision: 'b'.repeat(64), policy: { ...data.policy, ...input } }))
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={cache}><RequestLimitsPanel users={[{ id: 1, email: '91910797@example.com', username: '91910797', status: 'active', concurrency: 2, rpmLimit: 0 }]} /></QueryClientProvider>)
  const field = await screen.findByRole('spinbutton', { name: '默认请求上限（MiB）' })
  expect(field).toHaveValue(30)
  expect(screen.getByRole('spinbutton', { name: '用户 1 的请求上限（MiB）' })).toHaveValue(70)
  const concurrent = screen.getByRole('spinbutton', { name: '大请求并发上限' })
  expect(concurrent).not.toHaveAttribute('max')
  fireEvent.change(concurrent, { target: { value: '5' } })
  expect(concurrent).toBeValid()
  fireEvent.change(field, { target: { value: '35' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: '用户 1 的请求上限（MiB）' }), { target: { value: '80' } })
  fireEvent.click(screen.getByRole('button', { name: '保存请求限制' }))
  await waitFor(() => expect(api.saveRequestLimits).toHaveBeenCalledWith(expect.objectContaining({ revision: data.revision, defaultMaxMiB: 35, maxLargeConcurrent: 5, userOverrides: [{ userId: 1, maxMiB: 80 }] }), expect.anything()))
  await screen.findByText('请求限制已保存，新请求立即生效。')
  vi.mocked(api.saveRequestLimits).mockRejectedValueOnce(new Error('策略已变化，请重新载入后保存'))
  fireEvent.change(field, { target: { value: '40' } })
  fireEvent.click(screen.getByRole('button', { name: '保存请求限制' }))
  await screen.findByText('策略已变化，请重新载入后保存')
  expect(field).toHaveValue(40)
})
