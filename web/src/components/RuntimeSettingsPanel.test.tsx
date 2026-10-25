import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeSettingsPanel } from './RuntimeSettingsPanel'
import { api } from '@/lib/api'
vi.mock('@/lib/api', () => ({ api: { runtimeSettings: vi.fn(), applyRuntimeSettings: vi.fn() } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const initial = { revision: 'a'.repeat(64), configured: { memoryMiB: 600, dbMaxOpenConnections: 15 }, effective: { memoryMiB: 600, dbMaxOpenConnections: 15 }, applying: false, lastApply: null }
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><RuntimeSettingsPanel /></QueryClientProvider>) }
it('场景-004-06/07：展示持久及运行参数，确认重启后提交已读取版本，显示应用结果', async () => {
  vi.mocked(api.runtimeSettings).mockResolvedValue(initial)
  vi.mocked(api.applyRuntimeSettings).mockResolvedValue({ ...initial, lastApply: { id: 'job', status: 'succeeded', actor: 'admin', startedAt: new Date().toISOString(), message: '参数已保存并生效' } })
  mount()
  const field = await screen.findByLabelText('数据库连接上限')
  expect(field).toHaveValue(15)
  expect(screen.getByLabelText('内存上限（MiB）')).toHaveValue(600)
  fireEvent.change(field, { target: { value: '18' } })
  fireEvent.click(screen.getByRole('button', { name: '保存并应用' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('重启 Sub2API')
  expect(api.applyRuntimeSettings).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '确认应用' }))
  await waitFor(() => expect(api.applyRuntimeSettings).toHaveBeenCalledWith({ revision: initial.revision, memoryMiB: 600, dbMaxOpenConnections: 18 }))
  expect(await screen.findByText('参数已保存并生效')).toBeInTheDocument()
})
it('场景-004-06：控制服务未安装时显示错误，不展示默认参数作为已生效值', async () => {
  vi.mocked(api.runtimeSettings).mockRejectedValue(new Error('控制服务不可用'))
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent('控制服务不可用')
  expect(screen.queryByRole('button', { name: '保存并应用' })).not.toBeInTheDocument()
})
