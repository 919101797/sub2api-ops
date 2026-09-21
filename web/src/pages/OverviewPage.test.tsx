import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverviewPage } from './OverviewPage'
import { dashboardFixture } from '@/test/fixtures'
import { api } from '@/lib/api'
vi.mock('@/lib/api', () => ({ api: { run: vi.fn(), dashboard: vi.fn() } }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function mount(dashboard = dashboardFixture()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage dashboard={dashboard} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
describe('OverviewPage', () => {
  it('场景-008-16：未知容量明确显示为未统计，不伪装成零', () => {
    const dashboard = dashboardFixture()
    dashboard.accounts.forEach((account) => {
      delete account.capacity
    })
    mount(dashboard)
    const metrics = screen.getByRole('region', { name: '资源指标' })
    expect(within(metrics).getAllByText('—')).toHaveLength(2)
    expect(metrics).not.toHaveTextContent('US$0.00')
    expect(screen.getByRole('region', { name: '周限压力' })).toHaveTextContent('等待样本')
  })
  it('场景-008-16：部分容量汇总明确标注覆盖范围', () => {
    const dashboard = dashboardFixture()
    delete dashboard.accounts[1]!.capacity
    mount(dashboard)
    const metrics = screen.getByRole('region', { name: '资源指标' })
    expect(metrics).toHaveTextContent('1 / 2 个账号已统计')
    expect(metrics).toHaveTextContent('US$2,075.85')
  })
  it('场景-008-02：手动执行等待期间禁止重复提交，完成后显示接受状态', async () => {
    let complete!: (value: { accepted: boolean }) => void
    vi.mocked(api.run).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    mount()
    const buttons = screen.getAllByRole('button', { name: '立即执行' })
    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(buttons[0]).toBeDisabled())
    fireEvent.click(buttons[0]!)
    expect(api.run).toHaveBeenCalledTimes(1)
    complete({ accepted: true })
    expect(await screen.findByRole('status')).toHaveTextContent('任务已接受')
  })
})
