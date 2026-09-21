import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { AppearanceProvider } from './Appearance'
import { AppShell } from './AppShell'
import { PageHeading } from './ui'

vi.mock('./open-source/Ferrofluid', () => ({ default: () => <canvas data-renderer="ferrofluid" /> }))
vi.mock('./open-source/LightTunnel', () => ({ default: () => <canvas data-renderer="lighttunnel" /> }))

function CurrentPath() {
  return <output aria-label="当前路径">{useLocation().pathname}</output>
}

const user = { id: 1, email: 'operator@example.com', username: 'operator', role: 'admin' as const }
const touch = (identifier: number, clientX: number, clientY: number) => ({ identifier, clientX, clientY })

describe('AppShell mobile swipe navigation', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 820px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('switches to adjacent menu items with horizontal touch gestures', () => {
    render(
      <AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}>
        <MemoryRouter initialEntries={['/activity']}>
          <AppShell user={user} onLogout={vi.fn()}><CurrentPath /></AppShell>
        </MemoryRouter>
      </AppearanceProvider>,
    )

    const workspace = document.querySelector<HTMLElement>('.workspace')!
    fireEvent.touchStart(workspace, { touches: [touch(1, 300, 280)] })
    fireEvent.touchMove(workspace, { touches: [touch(1, 210, 286)] })
    expect(document.querySelector('.workspace__inner')).toHaveClass('workspace__inner--dragging')
    expect((document.querySelector('.workspace__inner') as HTMLElement).style.getPropertyValue('--page-drag-x')).toBe('-90px')
    expect(Number(screen.getByRole('navigation', { name: '移动端导航' }).style.getPropertyValue('--mobile-active-index'))).toBeGreaterThan(3)
    fireEvent.touchEnd(workspace, { changedTouches: [touch(1, 210, 286)], touches: [] })
    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/settings')
    expect(screen.getByRole('navigation', { name: '移动端导航' })).toHaveStyle({ '--mobile-active-index': '4' })
    expect(document.querySelector('.workspace__inner')).toHaveClass('workspace__inner--enter-next')
    expect(document.querySelector('.workspace__inner')).toHaveStyle({ '--page-enter-offset': '300px' })

    fireEvent.touchStart(workspace, { touches: [touch(2, 100, 280)] })
    fireEvent.touchMove(workspace, { touches: [touch(2, 190, 284)] })
    fireEvent.touchEnd(workspace, { changedTouches: [touch(2, 190, 284)], touches: [] })
    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/activity')
    expect(screen.getByRole('navigation', { name: '移动端导航' })).toHaveStyle({ '--mobile-active-index': '3' })
    expect(document.querySelector('.workspace__inner')).toHaveClass('workspace__inner--enter-previous')
    expect(document.querySelector('.workspace__inner')).toHaveStyle({ '--page-enter-offset': '-300px' })
  })

  it('ignores vertical, edge and form-control gestures', () => {
    render(
      <AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}>
        <MemoryRouter initialEntries={['/activity']}>
          <AppShell user={user} onLogout={vi.fn()}><input aria-label="页面输入" /><CurrentPath /></AppShell>
        </MemoryRouter>
      </AppearanceProvider>,
    )

    const workspace = document.querySelector<HTMLElement>('.workspace')!
    fireEvent.touchStart(workspace, { touches: [touch(1, 260, 200)] })
    fireEvent.touchMove(workspace, { touches: [touch(1, 230, 300)] })
    fireEvent.touchEnd(workspace, { changedTouches: [touch(1, 170, 310)], touches: [] })

    fireEvent.touchStart(workspace, { touches: [touch(2, 12, 200)] })
    fireEvent.touchEnd(workspace, { changedTouches: [touch(2, 120, 202)], touches: [] })

    const input = screen.getByRole('textbox', { name: '页面输入' })
    fireEvent.touchStart(input, { touches: [touch(3, 280, 200)] })
    fireEvent.touchEnd(input, { changedTouches: [touch(3, 170, 202)], touches: [] })

    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/activity')
  })

  it('switches modules when the swipe begins on a full-card button surface', () => {
    render(
      <AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}>
        <MemoryRouter initialEntries={['/activity']}>
          <AppShell user={user} onLogout={vi.fn()}><button type="button">整卡操作层</button><CurrentPath /></AppShell>
        </MemoryRouter>
      </AppearanceProvider>,
    )

    const button = screen.getByRole('button', { name: '整卡操作层' })
    fireEvent.touchStart(button, { touches: [touch(4, 280, 220)] })
    fireEvent.touchMove(button, { touches: [touch(4, 170, 224)] })
    fireEvent.touchEnd(button, { changedTouches: [touch(4, 170, 224)], touches: [] })

    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/settings')
  })

  it('snaps the page back when the drag does not reach the switch threshold', () => {
    render(
      <AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}>
        <MemoryRouter initialEntries={['/activity']}>
          <AppShell user={user} onLogout={vi.fn()}><CurrentPath /></AppShell>
        </MemoryRouter>
      </AppearanceProvider>,
    )

    const workspace = document.querySelector<HTMLElement>('.workspace')!
    fireEvent.touchStart(workspace, { touches: [touch(5, 250, 240)] })
    fireEvent.touchMove(workspace, { touches: [touch(5, 210, 242)] })
    fireEvent.touchEnd(workspace, { changedTouches: [touch(5, 210, 242)], touches: [] })

    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/activity')
    expect(document.querySelector('.workspace__inner')).toHaveClass('workspace__inner--snapping')
    expect((document.querySelector('.workspace__inner') as HTMLElement).style.getPropertyValue('--page-drag-x')).toBe('0px')
    expect(screen.getByRole('navigation', { name: '移动端导航' })).toHaveStyle({ '--mobile-active-index': '3' })
  })

  it('场景-008-08：主题面板挂载到页面级弹层，不受侧栏裁切', () => {
    localStorage.setItem('ops-sidebar', 'expanded')
    render(
      <AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}>
        <MemoryRouter>
          <AppShell user={user} onLogout={vi.fn()}><CurrentPath /></AppShell>
        </MemoryRouter>
      </AppearanceProvider>,
    )

    const trigger = document.querySelector<HTMLButtonElement>('.appearance-control--sidebar .appearance-trigger')!
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '外观设置' })
    expect(dialog).toBeInTheDocument()
    expect(dialog.closest('.sidebar')).toBeNull()
    expect(dialog).toHaveClass('appearance-popover--sidebar')
  })

  it('场景-008-08：窄屏时将主题面板限制在视口内并允许自身滚动', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 360 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('appearance-popover')) {
        return { left: 0, top: 0, right: 296, bottom: 421, width: 296, height: 421, x: 0, y: 0, toJSON: () => ({}) }
      }
      if (this.classList.contains('appearance-trigger')) {
        return { left: 272, top: 16, right: 308, bottom: 52, width: 36, height: 36, x: 272, y: 16, toJSON: () => ({}) }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
    })
    render(
      <AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}>
        <MemoryRouter>
          <AppShell user={user} onLogout={vi.fn()}><CurrentPath /></AppShell>
        </MemoryRouter>
      </AppearanceProvider>,
    )

    const trigger = document.querySelector<HTMLButtonElement>('.appearance-control--header .appearance-trigger')!
    fireEvent.click(trigger)

    expect(screen.getByRole('dialog', { name: '外观设置' })).toHaveStyle({
      top: '12px',
      left: '12px',
      maxHeight: '336px',
    })
  })

  it('场景-008-09：切换深色后保存外观，并支持 Escape 关闭', () => {
    render(<AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}><MemoryRouter><AppShell user={user} onLogout={vi.fn()}><PageHeading title="账号与分组" /></AppShell></MemoryRouter></AppearanceProvider>)
    fireEvent.click(document.querySelector<HTMLButtonElement>('.appearance-control--header .appearance-trigger')!)
    fireEvent.click(screen.getByRole('button', { name: '深色' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem('sub2api-ops-appearance-v1') ?? '{}')).toEqual({ theme: 'dark', style: 'orbital' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '外观设置' })).not.toBeInTheDocument()
  })
  it('场景-008-04：横向表格的拖动不切换路由', () => {
    render(<AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}><MemoryRouter initialEntries={['/activity']}><AppShell user={user} onLogout={vi.fn()}><div data-no-swipe data-testid="table-scroll">横向列表</div><CurrentPath /></AppShell></MemoryRouter></AppearanceProvider>)
    const list = screen.getByTestId('table-scroll')
    fireEvent.touchStart(list, { touches: [touch(8, 280, 220)] })
    fireEvent.touchMove(list, { touches: [touch(8, 170, 224)] })
    fireEvent.touchEnd(list, { changedTouches: [touch(8, 170, 224)], touches: [] })
    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/activity')
  })

  it('场景-008-01：通过快捷键检索功能并跳转到所选页面', () => {
    render(<AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}><MemoryRouter><AppShell user={user} onLogout={vi.fn()}><CurrentPath /></AppShell></MemoryRouter></AppearanceProvider>)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const search = screen.getByRole('textbox', { name: '搜索功能' })
    expect(search).toHaveFocus()
    fireEvent.change(search, { target: { value: '活动' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/activity')
  })

  it('场景-008-01：移动账户菜单展示身份并提供退出入口', () => {
    const logout = vi.fn()
    render(<AppearanceProvider initialPreference={{ theme: 'light', style: 'orbital' }}><MemoryRouter><AppShell user={user} onLogout={logout}><CurrentPath /></AppShell></MemoryRouter></AppearanceProvider>)
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    expect(screen.getByRole('dialog', { name: '当前账户' })).toHaveTextContent(user.email)
    fireEvent.click(screen.getByRole('button', { name: '退出当前账号' }))
    expect(logout).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('场景-008-09：九套皮肤都可选择，场景与偏好同步更新', () => {
    render(<AppearanceProvider initialPreference={{ theme: 'dark', style: 'orbital' }}><MemoryRouter><AppShell user={user} onLogout={vi.fn()}><PageHeading title="运维总览" /></AppShell></MemoryRouter></AppearanceProvider>)
    fireEvent.click(document.querySelector<HTMLButtonElement>('.appearance-control--header .appearance-trigger')!)
    for (const [name, style] of [['日蚀', 'orbital'], ['流光', 'quantum'], ['磁流', 'ferrofluid'], ['光隧', 'lighttunnel'], ['极光', 'aurora'], ['潮汐', 'tidal'], ['奔月', 'moon'], ['星河爆炸', 'galaxy'], ['星云潮生', 'nebula']]) {
      fireEvent.click(screen.getByRole('button', { name: `选择${name}皮肤` }))
      expect(document.documentElement.dataset.style).toBe(style)
      expect(document.querySelector('.visual-hero')).toHaveAttribute('data-scene', style)
      expect(JSON.parse(localStorage.getItem('sub2api-ops-appearance-v1')!)).toEqual({ theme: 'dark', style })
    }
    expect(document.querySelectorAll('.visual-hero')).toHaveLength(1)
  })

})
