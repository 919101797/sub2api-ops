import { SCENE_TOGGLE_EVENT } from './scenes/sceneInteraction'
import { CosmicPreview } from './CosmicPreview'
import { isCosmicStyle } from './scenes/cosmicMotion'
import { SelectionRail, SelectionIndicator } from './SelectionRail'
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Monitor,
  Moon,
  Sun,
  X,
  Eclipse,
  Waves,
  Droplets,
  Orbit,
  Wind,
  WavesLadder,
  MoonStar,
  Sparkles,
  Cloud,
} from 'lucide-react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type VisualStyle =
  'orbital' | 'quantum' | 'ferrofluid' | 'lighttunnel' | 'aurora' | 'tidal' | 'moon' | 'galaxy' | 'nebula'
const ReactBitsPreview = lazy(() => import('./ReactBitsScene').then((module) => ({ default: module.ReactBitsScene })))
export const skinOptions = [
  { value: 'orbital', label: '日蚀', note: '日冕与月影', icon: Eclipse },
  { value: 'quantum', label: '流光', note: '丝绸能量束', icon: Waves },
  { value: 'ferrofluid', label: '磁流', note: '液态金属场', icon: Droplets },
  { value: 'lighttunnel', label: '光隧', note: '纵深与跃迁', icon: Orbit },
  { value: 'aurora', label: '极光', note: '翡翠天幕', icon: Wind },
  { value: 'tidal', label: '潮汐', note: '深海涟漪', icon: WavesLadder },
  { value: 'moon', label: '奔月', note: '嫦娥逐月，星火接续', icon: MoonStar },
  { value: 'galaxy', label: '星河爆炸', note: '微光初醒，星河绽放', icon: Sparkles },
  { value: 'nebula', label: '星云潮生', note: '女娲补天，万星复明', icon: Cloud },
] satisfies Array<{ value: VisualStyle; label: string; note: string; icon: typeof Eclipse }>
interface AppearancePreference {
  theme: ThemeMode
  style: VisualStyle
}
interface AppearanceContextValue extends AppearancePreference {
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: ThemeMode) => void
  setStyle: (style: VisualStyle) => void
}
const STORAGE_KEY = 'sub2api-ops-appearance-v1'
const AppearanceContext = createContext<AppearanceContextValue | null>(null)
const themeOptions = [
  { value: 'light', label: '明亮', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
] satisfies Array<{ value: ThemeMode; label: string; icon: typeof Sun }>
function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  return theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
}
function applyTheme(theme: ThemeMode, style: VisualStyle) {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.style = style
  document.documentElement.style.colorScheme = resolved
  return resolved
}
export function initializeAppearance(): AppearancePreference {
  let theme: ThemeMode = 'dark'
  let style: VisualStyle = 'orbital'
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as AppearancePreference | null
    if (themeOptions.some((option) => option.value === saved?.theme)) theme = saved!.theme
    if (skinOptions.some((option) => option.value === saved?.style)) style = saved!.style
  } catch {
    /* Browser storage can be unavailable. */
  }
  applyTheme(theme, style)
  return { theme, style }
}
export function AppearanceProvider({
  initialPreference,
  children,
}: {
  initialPreference: AppearancePreference
  children: ReactNode
}) {
  const [theme, setTheme] = useState(initialPreference.theme)
  const [style, updateStyle] = useState(initialPreference.style)
  const setStyle = useCallback((next: VisualStyle) => {
    if (next === style) window.dispatchEvent(new CustomEvent(SCENE_TOGGLE_EVENT))
    else updateStyle(next)
  }, [style])
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(theme))
  useLayoutEffect(() => {
    setResolvedTheme(applyTheme(theme, style))
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, style }))
    } catch {
      /* Keep the session preference. */
    }
  }, [theme, style])
  useEffect(() => {
    if (theme !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setResolvedTheme(applyTheme(theme, style))
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [theme, style])
  return (
    <AppearanceContext.Provider value={{ theme, style, resolvedTheme, setTheme, setStyle }}>
      {children}
    </AppearanceContext.Provider>
  )
}
export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance 必须在 AppearanceProvider 内使用')
  return context
}
export function AppearanceControl({
  placement,
  compact = false,
}: {
  placement: 'sidebar' | 'header' | 'login'
  compact?: boolean
}) {
  const { theme, style, resolvedTheme, setTheme, setStyle } = useAppearance()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])
  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect()
    const popover = popoverRef.current?.getBoundingClientRect()
    if (!trigger || !popover) return
    const width = document.documentElement.clientWidth
    const height = document.documentElement.clientHeight
    const maxHeight = Math.max(0, height - 24)
    const left = placement === 'sidebar' ? (compact ? trigger.right + 12 : trigger.left) : trigger.right - popover.width
    const top = placement === 'sidebar' ? trigger.top - Math.min(popover.height, maxHeight) - 10 : trigger.bottom + 10
    setPosition({
      left: Math.max(12, Math.min(left, width - popover.width - 12)),
      top: Math.max(12, Math.min(top, height - Math.min(popover.height, maxHeight) - 12)),
      maxHeight,
    })
  }, [placement, compact])
  useLayoutEffect(() => {
    if (!open) return
    place()
    popoverRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open, place])
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node))
        setOpen(false)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') {
        const buttons = [...popoverRef.current!.querySelectorAll<HTMLButtonElement>('button')]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if ((event.shiftKey && index === 0) || (!event.shiftKey && index === buttons.length - 1)) {
          event.preventDefault()
          ;(event.shiftKey ? buttons.at(-1) : buttons[0])?.focus()
        }
      }
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', keyboard)
    }
  }, [open, close])
  return (
    <div className={`appearance-control appearance-control--${placement}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`appearance-trigger${compact ? ' appearance-trigger--compact' : ''}`}
        aria-label="外观设置"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {resolvedTheme === 'dark' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
        {!compact && (
          <>
            <span>外观设置</span>
            <small>{skinOptions.find((option) => option.value === style)?.label}</small>
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className={`appearance-popover appearance-popover--${placement}`}
            role="dialog"
            aria-label="外观设置"
            style={position}
          >
            <header>
              <strong>外观设置</strong>
              <button type="button" aria-label="关闭外观设置" onClick={close}>
                <X size={16} />
              </button>
            </header>
            <div className="appearance-skin-options" aria-label="主题皮肤">
              {skinOptions.map(({ value, label, note, icon: Icon }, index) => (
                <button
                  type="button"
                  key={value}
                  aria-label={`选择${label}皮肤`}
                  title={style === value && value !== 'orbital' ? "再次选择可展开或收回场景" : note}
                  aria-pressed={style === value}
                  onClick={() => setStyle(value)}
                >
                  <span className={`skin-preview skin-preview--${value}`} aria-hidden="true">
                    {isCosmicStyle(value) ? (
                      <CosmicPreview style={value} />
                    ) : value === 'ferrofluid' || value === 'lighttunnel' ? (
                      <Suspense fallback={null}>
                        <ReactBitsPreview style={value} theme="dark" preview />
                      </Suspense>
                    ) : (
                      <>
                        <i />
                        <i />
                        <i />
                      </>
                    )}
                    <b>{String(index + 1).padStart(2, '0')}</b>
                  </span>
                  <span className="skin-choice-label">
                    <Icon size={14} />
                    <strong>{label}</strong>
                    {style === value && <Check size={13} />}
                  </span>
                  <small>{note}</small>
                </button>
              ))}
            </div>
            <div className="appearance-mode-label">明暗模式</div>
            <SelectionRail className="appearance-theme-options" role="group" aria-label="明暗模式">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button type="button" key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>
                  <SelectionIndicator active={theme === value} />
                  <span className={`theme-preview theme-preview--${value}`} aria-hidden="true">
                    <i />
                    <b />
                    <b />
                  </span>
                  <span>
                    <Icon size={14} aria-hidden="true" />
                    {label}
                    {theme === value && <Check size={13} aria-hidden="true" />}
                  </span>
                </button>
              ))}
            </SelectionRail>
            <p>仅应用于当前浏览器</p>
          </div>,
          document.body,
        )}
    </div>
  )
}

export function SceneSwitcher() {
  const { style, setStyle } = useAppearance()
  return (
    <SelectionRail className="scene-switcher" role="group" aria-label="实时场景">
      {skinOptions.map(({ value, label, icon: Icon }) => (
        <button
          type="button"
          key={value}
          aria-label={`切换到${label}`}
          title={style === value && value !== 'orbital' ? `${label}：再次选择可展开或收回场景` : label}
          aria-pressed={style === value}
          onClick={() => setStyle(value)}
        >
          <SelectionIndicator active={style === value} />
          <Icon size={14} />
          <span className="scene-label">{label}</span>
        </button>
      ))}
    </SelectionRail>
  )
}
