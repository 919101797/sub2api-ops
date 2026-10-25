import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppearanceProvider, SceneSwitcher, useAppearance } from './Appearance'
import { VisualHero } from './VisualHero'
const textureLoading = vi.hoisted(() => ({ prepare: vi.fn<() => Promise<void[]>>(() => Promise.resolve([])) }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('场景-008-22：日蚀由明显偏食进入完整日冕，退回时保持大行程且不逐帧测量布局', () => {
  let id = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  vi.stubGlobal('CanvasRenderingContext2D', class {})
  const gradient = { addColorStop() {} }
  const context = new Proxy(
    {},
    { get: (_, key) => (String(key).includes('Gradient') ? () => gradient : () => {}), set: () => true },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D)
  const bounds = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1600,
    bottom: 1000,
    width: 1600,
    height: 1000,
    toJSON: () => ({}),
  })
  let time = performance.now()
  const advance = () =>
    act(() => {
      for (let i = 0; i < 180; i++) {
        time += 16.67
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((callback) => callback(time))
      }
    })
  const { unmount, rerender } = render(
    <AppearanceProvider initialPreference={{ theme: 'dark', style: 'orbital' }}>
      <VisualHero />
    </AppearanceProvider>,
  )
  const hero = document.querySelector<HTMLElement>('.visual-hero')!
  const start = Number(hero.dataset.eclipseProgress)
  expect(document.documentElement.style.getPropertyValue('--eclipse-darkness')).toBe('0%')
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1232, clientY: 310 })))
  advance()
  expect(Number(hero.dataset.eclipseProgress)).toBeGreaterThan(0.98)
  expect(document.documentElement.style.getPropertyValue('--eclipse-darkness')).toBe('100%')
  expect(Number(hero.dataset.eclipseProgress) - start).toBeGreaterThan(0.4)
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 30, clientY: 700 })))
  advance()
  expect(Number(hero.dataset.eclipseProgress)).toBeLessThan(0.62)
  expect(parseFloat(document.documentElement.style.getPropertyValue('--eclipse-darkness'))).toBeLessThan(25)
  expect(bounds).toHaveBeenCalledOnce()
  expect(frames.size).toBe(1)
  const canvas = document.querySelector('canvas')!
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(1_600_000)
  let visibility: DocumentVisibilityState = 'hidden'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(frames.size).toBe(0)
  visibility = 'visible'
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(frames.size).toBe(1)
  rerender(
    <AppearanceProvider key="quantum" initialPreference={{ theme: 'light', style: 'quantum' }}>
      <VisualHero />
    </AppearanceProvider>,
  )
  expect(document.documentElement.style.getPropertyValue('--eclipse-darkness')).toBe('')
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    addEventListener() {},
    removeEventListener() {},
  }))
  rerender(
    <AppearanceProvider key="reduced" initialPreference={{ theme: 'light', style: 'orbital' }}>
      <VisualHero />
    </AppearanceProvider>,
  )
  expect(frames.size).toBe(0)
  const fixedExposure = document.documentElement.style.getPropertyValue('--eclipse-darkness')
  expect(parseFloat(fixedExposure)).toBeGreaterThan(0)
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1232, clientY: 310 })))
  expect(document.documentElement.style.getPropertyValue('--eclipse-darkness')).toBe(fixedExposure)
  unmount()
  expect(document.documentElement.style.getPropertyValue('--eclipse-darkness')).toBe('')
})

vi.mock('./scenes/cosmicTextures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scenes/cosmicTextures')>()
  return {
    ...actual,
    prepareCosmicTextures: textureLoading.prepare,
    getMoonTexture: () => document.createElement('canvas'),
    getEarthTexture: () => document.createElement('canvas'),
    getGroundTexture: () => document.createElement('canvas'),
    getNebulaTexture: () => document.createElement('canvas'),
  }
})

function ToggleTheme() {
  const { setTheme } = useAppearance()
  return <button onClick={() => setTheme('light')}>测试明亮模式</button>
}

it.each(['moon', 'nebula', 'galaxy', 'quantum', 'aurora', 'tidal'] as const)('场景-008-26/29：%s 由操作推进、回退，落稳休眠，切换释放', async (style) => {
  let id = 0,
    time = performance.now()
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  vi.stubGlobal('CanvasRenderingContext2D', class {})
  const gradient = { addColorStop() {} }
  const context = new Proxy(
    {},
    { get: (_, key) => (String(key).includes('Gradient') ? () => gradient : () => {}), set: () => true },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D)
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1600,
    bottom: 1000,
    width: 1600,
    height: 1000,
    toJSON: () => ({}),
  })
  const advance = (count: number) =>
    act(() => {
      for (let i = 0; i < count; i++) {
        time += 40
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((callback) => callback(time))
      }
    })
  const { container, rerender, unmount } = render(
    <AppearanceProvider initialPreference={{ theme: 'dark', style }}>
      <VisualHero />
      <button className="business-action">刷新数据</button>
      <SceneSwitcher />
      <ToggleTheme />
    </AppearanceProvider>,
  )
  expect(container.querySelector('.scene-experience, .scene-chapter')).toBeNull()
  expect(container.textContent).not.toMatch(/静海着陆|落脚于此|群星舒展|余辉新生/)
  const hero = container.querySelector<HTMLElement>('.visual-hero')!
  await act(async () => {})
  advance(400)
  expect(Number(hero.dataset.sceneProgress)).toBe(0)
  expect(frames.size).toBe(0)
  const center: [number, number] = style === 'moon' ? [1248, 220] : style === 'galaxy' || style === 'nebula' ? [1184, style === 'galaxy' ? 340 : 300] : [1232, 310]
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: center[0], clientY: center[1] })))
  advance(20)
  expect(Number(hero.dataset.sceneProgress)).toBeGreaterThan(0.025)
  const before = Number(hero.dataset.sceneProgress)
  act(() =>
    container
      .querySelector('.business-action')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 1232, clientY: 310 })),
  )
  advance(1)
  if (['moon', 'galaxy', 'nebula'].includes(style)) expect(Math.abs(Number(hero.dataset.sceneProgress) - before)).toBeLessThan(0.02)
  else expect(Number(hero.dataset.sceneProgress)).toBeLessThan(before)
  advance(30)
  expect(Number(hero.dataset.sceneProgress)).toBeLessThan(before)
  let visibility: DocumentVisibilityState = 'hidden'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(frames.size).toBe(0)
  const paused = Number(hero.dataset.sceneProgress)
  time += 60_000
  visibility = 'visible'
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  advance(1)
  expect(Number(hero.dataset.sceneProgress) - paused).toBeLessThan(0.011)
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: center[0], clientY: center[1] })))
  advance(350)
  expect(hero.dataset.sceneProgress).toBe('1.000')
  expect(frames.size).toBe(0)
  act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === '测试明亮模式')!.click())
  await act(async () => {})
  expect(hero.dataset.sceneProgress).toBe('1.000')
  advance(2)
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 100 })))
  expect(frames.size).toBe(1)
  advance(['moon', 'galaxy', 'nebula'].includes(style) ? 400 : 120)
  expect(frames.size).toBe(0)
  const measurementCount = bounds.mock.calls.length
  expect(hero.dataset.sceneProgress).toBe('0.000')
  const replayLabel = { moon: '切换到奔月', galaxy: '切换到星河爆炸', nebula: '切换到星云潮生', quantum: '切换到流光', aurora: '切换到极光', tidal: '切换到潮汐' }[style]
  act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${replayLabel}"]`)!.click())
  expect(Number(hero.dataset.sceneProgress)).toBeLessThan(0.01)
  expect(frames.size).toBe(1)
  advance(350)
  expect(hero.dataset.sceneProgress).toBe('1.000')
  expect(frames.size).toBe(0)
  expect(bounds.mock.calls.length).toBe(measurementCount)
  act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${replayLabel}"]`)!.click())
  advance(350)
  expect(hero.dataset.sceneProgress).toBe('0.000')
  const canvas = container.querySelector('canvas')!
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_200_000)
  if (['moon', 'galaxy', 'nebula'].includes(style)) expect(canvas.width).toBeGreaterThanOrEqual(1600)
  rerender(
    <AppearanceProvider key="next" initialPreference={{ theme: 'dark', style: 'quantum' }}>
      <VisualHero />
    </AppearanceProvider>,
  )
  for (const property of ['--cosmic-light', '--cosmic-warmth', '--cosmic-travel'])
    expect(document.documentElement.style.getPropertyValue(property)).toBe('')
  unmount()
  expect(frames.size).toBe(0)
})

it('场景-008-41：素材解码期间不提前播放，准备完成后从原进度接续叙事', async () => {
  let resolveTextures!: (value: void[]) => void
  textureLoading.prepare.mockImplementationOnce(() => new Promise(resolve => { resolveTextures = resolve }))
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  vi.stubGlobal('CanvasRenderingContext2D', class {})
  const gradient = { addColorStop() {} }
  const context = new Proxy({}, { get: (_, key) => String(key).includes('Gradient') ? () => gradient : () => {}, set: () => true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1600, height: 1000 } as DOMRect)
  const { container } = render(<AppearanceProvider initialPreference={{theme:'dark',style:'galaxy'}}><VisualHero/><SceneSwitcher/></AppearanceProvider>)
  const hero = container.querySelector<HTMLElement>('.visual-hero')!
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="切换到星河爆炸"]')!.click())
  expect(hero.dataset.sceneProgress).toBe('0.000')
  expect(frames.size).toBe(0)
  await act(async () => resolveTextures([]))
  expect(Number(hero.dataset.sceneProgress)).toBeLessThan(0.001)
  expect(frames.size).toBe(1)
  let time = performance.now()
  act(() => { for (let i = 0; i < 400; i++) {
    time += 40; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time))
  } })
  expect(hero.dataset.sceneProgress).toBe('1.000')
  expect(frames.size).toBe(0)
})

it('场景-008-28：减弱动态效果展示静态宇宙，没有可触发的爆发入口', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    addEventListener() {},
    removeEventListener() {},
  }))
  const frames = vi.fn()
  vi.stubGlobal('requestAnimationFrame', frames)
  const { container } = render(
    <AppearanceProvider initialPreference={{ theme: 'light', style: 'galaxy' }}>
      <VisualHero />
    </AppearanceProvider>,
  )
  expect(container.querySelector('.scene-experience, .scene-chapter')).toBeNull()
  expect(container.textContent).not.toMatch(/静海着陆|落脚于此|群星舒展|余辉新生/)
  expect(frames).not.toHaveBeenCalled()
})
