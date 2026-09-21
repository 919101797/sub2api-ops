import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'
import { dashboardFixture, settingsFixture } from '@/test/fixtures'
import { api } from '@/lib/api'
vi.mock('@/lib/api', () => ({
  api: { settingsOptions: vi.fn(), promptStorage: vi.fn(), saveConfig: vi.fn(), purgePrompts: vi.fn() },
}))
beforeEach(() => {
  vi.mocked(api.settingsOptions).mockResolvedValue(settingsFixture)
  vi.mocked(api.promptStorage).mockResolvedValue({
    generatedAt: '',
    purgeBefore: '',
    logs: { records: 5, databaseBytes: 0 },
    images: { files: 0, bytes: 0 },
    totalBytes: 0,
  })
  vi.mocked(api.saveConfig).mockImplementation(async (config) => config)
  vi.mocked(api.purgePrompts).mockResolvedValue({
    before: '2026-09-06',
    deletedRecords: 5,
    deletedImages: 0,
    freedImageBytes: 0,
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsPage dashboard={dashboardFixture()} />
    </QueryClientProvider>,
  )
}
describe('SettingsPage', () => {
  it('场景-008-12：切换设置面板保留草稿，并保存完整配置', async () => {
    mount()
    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled()
    fireEvent.change(screen.getAllByRole('textbox', { name: '显示名称' })[0]!, { target: { value: '重新命名的账号' } })
    fireEvent.click(screen.getByRole('tab', { name: '同步参数' }))
    expect(screen.getByText('有未保存的更改')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '账号与分组' }))
    expect(screen.getAllByRole('textbox', { name: '显示名称' })[0]).toHaveValue('重新命名的账号')
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledOnce())
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].accounts[0]!.label).toBe('重新命名的账号')
    await waitFor(() => expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled())
  })
  it('场景-008-12：隐藏面板有无效值时定位错误面板，不发送配置', async () => {
    mount()
    fireEvent.change(screen.getAllByRole('textbox', { name: '显示名称' })[0]!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: '同步参数' }))
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    expect(api.saveConfig).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: '账号与分组' })).toHaveAttribute('aria-selected', 'true')
  })
  it('场景-008-13：危险操作取消不请求，输入确认后才清空', async () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: '内容与存储' }))
    fireEvent.click(screen.getByRole('button', { name: '清空全部' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(api.purgePrompts).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '清空全部' }))
    const dialog = screen.getByRole('dialog', { name: '清空全部审计数据' })
    fireEvent.change(within(dialog).getByLabelText('确认文本'), { target: { value: '清空全部' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(api.purgePrompts).toHaveBeenCalledWith({ scope: 'all' }, expect.anything()))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(/已删除 5 条审计记录/)).toBeInTheDocument()
  })
})
