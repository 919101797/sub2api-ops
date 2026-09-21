import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { AppearanceProvider } from './components/Appearance'
import { api } from './lib/api'
import { dashboardFixture } from './test/fixtures'
vi.mock('./lib/api', async (original) => ({
  ...(await original<typeof import('./lib/api')>()),
  api: { bootstrap: vi.fn(), dashboard: vi.fn(), logout: vi.fn() },
}))
vi.mock('./pages/OverviewPage', () => ({ OverviewPage: () => <h1>运维总览</h1> }))
vi.mock('./pages/LoginPage', () => ({ LoginPage: () => <h1>登录控制台</h1> }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function mount() {
  window.history.replaceState(null, '', import.meta.env.BASE_URL)
  const dashboard = dashboardFixture()
  vi.mocked(api.bootstrap).mockResolvedValue({
    user: { id: 1, email: 'admin@example.com', username: 'Admin', role: 'admin' },
    dashboard,
  })
  vi.mocked(api.dashboard).mockResolvedValue(dashboard)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(['prompts', 'private'], { items: ['private-record'] })
  render(
    <AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </AppearanceProvider>,
  )
  return client
}
describe('App session UI', () => {
  it('退出成功立即回到登录页并清空私有查询缓存', async () => {
    vi.mocked(api.logout).mockResolvedValue({ ok: true })
    const client = mount()
    await screen.findByRole('heading', { name: '运维总览' })
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('heading', { name: '登录控制台' })).toBeInTheDocument()
    expect(client.getQueryData(['prompts', 'private'])).toBeUndefined()
    expect(client.getQueryData(['bootstrap'])).toBeNull()
  })
  it('退出请求失败时显示错误，不宣称已经退出', async () => {
    vi.mocked(api.logout).mockRejectedValue(new Error('连接失败'))
    mount()
    await screen.findByRole('heading', { name: '运维总览' })
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('退出失败'))
    expect(await screen.findByRole('heading', { name: '运维总览' })).toBeInTheDocument()
  })
})
