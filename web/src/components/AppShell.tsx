import { SelectionRail, SelectionIndicator } from './SelectionRail'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
  ScanText,
  Settings,
  UsersRound,
  Search,
  Command,
} from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import type { SessionUser } from '@shared/contracts'
import { AppearanceControl, SceneSwitcher } from './Appearance'
import { VisualHero } from './VisualHero'
import { BrandMark } from './BrandMark'
import { Button } from './ui'
import { Dialog } from './Dialog'

const navigation = [
  { to: '/', label: '运维总览', icon: LayoutGrid },
  { to: '/accounts', label: '账号与分组', icon: UsersRound },
  { to: '/input-health', label: '输入健康', icon: ScanText },
  { to: '/activity', label: '自动化活动', icon: Activity },
  { to: '/settings', label: '系统设置', icon: Settings },
]

const SIDEBAR_STORAGE_KEY = 'ops-navigation-rail'
const MOBILE_BREAKPOINT = '(max-width: 820px)'
const SWIPE_EDGE_GUARD = 24
const SWIPE_BLOCK_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [data-no-swipe]'

interface SwipeGesture {
  touchId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  startIndex: number
  axis: 'pending' | 'horizontal'
}

interface TouchPoint {
  identifier: number
  clientX: number
  clientY: number
}

function findTouch(touches: ReactTouchEvent<HTMLElement>['touches'], identifier: number): TouchPoint | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index] ?? touches.item(index)
    if (touch?.identifier === identifier) return touch
  }
  return null
}

function initialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'expanded'
  } catch {
    return true
  }
}

export function AppShell({
  user,
  onLogout,
  children,
  logoutBusy = false,
}: PropsWithChildren<{ user: SessionUser; onLogout: () => void; logoutBusy?: boolean }>) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandSearch, setCommandSearch] = useState('')
  const [commandIndex, setCommandIndex] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
  const [pageEnterOffset, setPageEnterOffset] = useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const commandItems = navigation.filter((item) => item.label.includes(commandSearch.trim()))
  const openCommand = () => {
    setCommandSearch('')
    setCommandIndex(0)
    setCommandOpen(true)
  }
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k' &&
        !document.querySelector('[data-modal-layer]')
      ) {
        event.preventDefault()
        openCommand()
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [])
  useEffect(() => {
    document.title = `${navigation.find((item) => item.to === location.pathname)?.label ?? '控制台'} · Sub2API`
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])
  const activeNavigationIndex = Math.max(
    0,
    navigation.findIndex(({ to }) => to === location.pathname),
  )
  const previousNavigationIndex = useRef(activeNavigationIndex)
  const pageTransitionDirection =
    activeNavigationIndex === previousNavigationIndex.current
      ? null
      : activeNavigationIndex > previousNavigationIndex.current
        ? 'next'
        : 'previous'
  const swipeGesture = useRef<SwipeGesture | null>(null)
  const suppressClickUntil = useRef(0)
  const workspaceInner = useRef<HTMLDivElement>(null)
  const mobileNavigation = useRef<HTMLElement>(null)
  const snapBackTimer = useRef<number | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? 'collapsed' : 'expanded')
    } catch {
      // Storage may be unavailable in hardened browser contexts; the UI still works for this session.
    }
  }, [sidebarCollapsed])
  useEffect(() => {
    previousNavigationIndex.current = activeNavigationIndex
  }, [activeNavigationIndex])
  useEffect(
    () => () => {
      if (snapBackTimer.current !== null) window.clearTimeout(snapBackTimer.current)
    },
    [],
  )

  const resetDraggedPage = (startIndex: number, animateBack: boolean) => {
    const page = workspaceInner.current
    const nav = mobileNavigation.current
    nav?.classList.remove('mobile-nav--dragging')
    nav?.style.setProperty('--mobile-active-index', String(startIndex))
    if (!page) return

    page.classList.remove('workspace__inner--dragging')
    if (!animateBack) {
      page.classList.remove('workspace__inner--snapping')
      page.style.removeProperty('--page-drag-x')
      page.style.removeProperty('--page-drag-opacity')
      return
    }

    page.classList.add('workspace__inner--snapping')
    page.getBoundingClientRect()
    page.style.setProperty('--page-drag-x', '0px')
    page.style.setProperty('--page-drag-opacity', '1')
    if (snapBackTimer.current !== null) window.clearTimeout(snapBackTimer.current)
    snapBackTimer.current = window.setTimeout(() => {
      page.classList.remove('workspace__inner--snapping')
      page.style.removeProperty('--page-drag-x')
      page.style.removeProperty('--page-drag-opacity')
      snapBackTimer.current = null
    }, 380)
  }

  const startPageSwipe = (event: ReactTouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1 || !window.matchMedia(MOBILE_BREAKPOINT).matches) return
    if (document.querySelector('[role="dialog"]')) return
    if (event.target instanceof Element && event.target.closest(SWIPE_BLOCK_SELECTOR)) return
    const touch = event.touches[0] ?? event.touches.item(0)
    if (!touch) return
    const viewportWidth = document.documentElement.clientWidth
    if (touch.clientX <= SWIPE_EDGE_GUARD || touch.clientX >= viewportWidth - SWIPE_EDGE_GUARD) return
    swipeGesture.current = {
      touchId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      startIndex: activeNavigationIndex,
      axis: 'pending',
    }
  }

  const trackPageSwipe = (event: ReactTouchEvent<HTMLElement>) => {
    const gesture = swipeGesture.current
    if (!gesture) return
    const touch = findTouch(event.touches, gesture.touchId)
    if (!touch) return
    gesture.lastX = touch.clientX
    gesture.lastY = touch.clientY
    const rawDistanceX = gesture.lastX - gesture.startX
    const distanceX = Math.abs(rawDistanceX)
    const distanceY = Math.abs(gesture.lastY - gesture.startY)

    if (gesture.axis === 'pending') {
      if (Math.max(distanceX, distanceY) < 8) return
      if (distanceY >= distanceX) {
        swipeGesture.current = null
        return
      }
      gesture.axis = 'horizontal'
      workspaceInner.current?.classList.add('workspace__inner--dragging')
      mobileNavigation.current?.classList.add('mobile-nav--dragging')
    }

    if (event.cancelable) event.preventDefault()
    const viewportWidth = document.documentElement.clientWidth
    const atStartBoundary = gesture.startIndex === 0 && rawDistanceX > 0
    const atEndBoundary = gesture.startIndex === navigation.length - 1 && rawDistanceX < 0
    const draggedDistanceX = atStartBoundary || atEndBoundary ? rawDistanceX * 0.22 : rawDistanceX
    const dragProgress = Math.min(1, Math.abs(draggedDistanceX) / viewportWidth)
    const page = workspaceInner.current
    page?.style.setProperty('--page-drag-x', `${draggedDistanceX}px`)
    page?.style.setProperty('--page-drag-opacity', String(1 - dragProgress * 0.16))
    const indicatorIndex = Math.min(
      navigation.length - 1,
      Math.max(0, gesture.startIndex - draggedDistanceX / viewportWidth),
    )
    mobileNavigation.current?.style.setProperty('--mobile-active-index', String(indicatorIndex))
  }

  const finishPageSwipe = (event: ReactTouchEvent<HTMLElement>) => {
    const gesture = swipeGesture.current
    swipeGesture.current = null
    if (!gesture) return
    const touch = findTouch(event.changedTouches, gesture.touchId)
    const distanceX = (touch?.clientX ?? gesture.lastX) - gesture.startX
    const viewportWidth = document.documentElement.clientWidth
    const minimumDistance = Math.min(96, Math.max(54, viewportWidth * 0.18))
    const nextIndex = gesture.startIndex + (distanceX < 0 ? 1 : -1)
    const destination = navigation[nextIndex]
    if (gesture.axis !== 'horizontal' || Math.abs(distanceX) < minimumDistance || !destination) {
      resetDraggedPage(gesture.startIndex, gesture.axis === 'horizontal')
      return
    }

    suppressClickUntil.current = performance.now() + 400
    const remainingDistance = distanceX < 0 ? viewportWidth + distanceX : -viewportWidth + distanceX
    setPageEnterOffset(`${remainingDistance}px`)
    resetDraggedPage(nextIndex, false)
    navigate(destination.to)
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}`}>
      <VisualHero />
      <a className="skip-link" href="#workspace-content">
        跳到主内容
      </a>
      <aside
        id="ops-sidebar"
        className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`}
        aria-label="控制台侧栏"
      >
        <div className="sidebar__content">
          <div className="sidebar__head">
            <div className="brand-lockup">
              <BrandMark />
              <div>
                <strong>
                  Sub2API<span className="brand-suffix"> / ops</span>
                </strong>
                <span>运维指挥空间</span>
              </div>
            </div>
          </div>
          <button className="sidebar-search" type="button" onClick={openCommand} aria-label="快速跳转">
            <Search size={16} />
            <span>快速跳转</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="nav-caption">工作空间</div>
          <SelectionRail as="nav" className="navigation" aria-label="主导航">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                aria-label={label}
                title={sidebarCollapsed ? label : undefined}
              >
                <SelectionIndicator active={location.pathname === to} />
                <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                <span>{label}</span>
                <span className="nav-active-dot" aria-hidden="true" />
              </NavLink>
            ))}
          </SelectionRail>
          <div className="sidebar-bottom">
            <AppearanceControl placement="sidebar" compact={sidebarCollapsed} />
          </div>
          <div className="sidebar__footer">
            <div className="operator" title={sidebarCollapsed ? `${user.username} · ${user.email}` : undefined}>
              <span className="operator__avatar" aria-hidden="true">
                {user.username.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{user.username}</strong>
                <small>{user.email}</small>
              </span>
            </div>
            <Button variant="quiet" onClick={onLogout} busy={logoutBusy} aria-label="退出登录">
              <LogOut size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </aside>
      <button
        type="button"
        className="sidebar-toggle"
        aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
        aria-controls="ops-sidebar"
        aria-expanded={!sidebarCollapsed}
        onClick={() => setSidebarCollapsed((value) => !value)}
      >
        {sidebarCollapsed ? (
          <ChevronRight size={18} strokeWidth={2.1} aria-hidden="true" />
        ) : (
          <ChevronLeft size={18} strokeWidth={2.1} aria-hidden="true" />
        )}
      </button>
      <main
        className="workspace"
        onTouchStart={startPageSwipe}
        onTouchMove={trackPageSwipe}
        onTouchEnd={finishPageSwipe}
        onTouchCancel={() => {
          const gesture = swipeGesture.current
          swipeGesture.current = null
          if (gesture) resetDraggedPage(gesture.startIndex, gesture.axis === 'horizontal')
        }}
        onClickCapture={(event) => {
          if (performance.now() >= suppressClickUntil.current) return
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <header className="workspace-bar">
          <div className="workspace-breadcrumb">
            <span>指挥空间</span>
            <span>/</span>
            <strong>{navigation[activeNavigationIndex]?.label}</strong>
          </div>
          <SceneSwitcher />
          <div className="workspace-tools">
            <span className="workspace-access">管理员空间</span>
            <button type="button" className="command-trigger" onClick={openCommand} aria-label="打开快速跳转">
              <Command size={14} />
              <span>K</span>
            </button>
            <span className="topbar-avatar">{user.username.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        <div className="mobile-bar">
          <div className="brand-lockup">
            <BrandMark />
            <strong>Sub2API Ops</strong>
          </div>
          <div className="mobile-account-tools">
            <AppearanceControl placement="header" compact />
            <button
              type="button"
              className="mobile-account-trigger"
              aria-label="账户菜单"
              disabled={logoutBusy}
              onClick={() => setAccountOpen(true)}
            >
              {user.username.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </div>
        <div
          id="workspace-content"
          tabIndex={-1}
          ref={workspaceInner}
          key={location.key}
          className={`workspace__inner${pageTransitionDirection ? ` workspace__inner--enter-${pageTransitionDirection}` : ''}`}
          style={pageEnterOffset ? ({ '--page-enter-offset': pageEnterOffset } as CSSProperties) : undefined}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setPageEnterOffset(null)
          }}
        >
          {children}
        </div>
      </main>
      <nav
        ref={mobileNavigation}
        className="mobile-nav"
        aria-label="移动端导航"
        style={{ '--mobile-active-index': activeNavigationIndex } as CSSProperties}
      >
        <span className="mobile-nav__indicator" aria-hidden="true" />
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} onClick={() => setPageEnterOffset(null)}>
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>
              {
                (
                  {
                    '/': '总览',
                    '/accounts': '账号',
                    '/input-health': '审计',
                    '/activity': '活动',
                    '/settings': '设置',
                  } as Record<string, string>
                )[to]
              }
            </span>
          </NavLink>
        ))}
      </nav>
      {accountOpen && (
        <Dialog title="当前账户" onClose={() => setAccountOpen(false)}>
          <div className="account-menu-body">
            <span className="operator__avatar">{user.username.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user.username}</strong>
              <p>{user.email}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setAccountOpen(false)
                onLogout()
              }}
            >
              <LogOut size={16} />
              退出当前账号
            </Button>
          </div>
        </Dialog>
      )}
      {commandOpen && (
        <Dialog title="快速跳转" onClose={() => setCommandOpen(false)} className="command-dialog">
          <div className="command-input">
            <Search size={20} />
            <input
              data-autofocus
              aria-label="搜索功能"
              placeholder="搜索功能…"
              value={commandSearch}
              onChange={(event) => {
                setCommandSearch(event.target.value)
                setCommandIndex(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setCommandIndex((value) => Math.min(value + 1, commandItems.length - 1))
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCommandIndex((value) => Math.max(0, value - 1))
                }
                if (event.key === 'Enter' && commandItems[commandIndex]) {
                  navigate(commandItems[commandIndex].to)
                  setCommandOpen(false)
                }
              }}
            />
          </div>
          <div className="command-results">
            {commandItems.map(({ to, label, icon: Icon }, index) => (
              <button
                type="button"
                key={to}
                className={index === commandIndex ? 'is-selected' : ''}
                onMouseEnter={() => setCommandIndex(index)}
                onClick={() => {
                  navigate(to)
                  setCommandOpen(false)
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!commandItems.length && <p className="quiet-empty">没有匹配的功能</p>}
          </div>
          <footer className="command-footer">
            <span>↑ ↓ 选择</span>
            <span>Enter 打开</span>
            <span>Esc 关闭</span>
          </footer>
        </Dialog>
      )}
    </div>
  )
}
