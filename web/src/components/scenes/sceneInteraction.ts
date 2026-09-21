import type { VisualStyle } from '../Appearance'
import { cosmicAtmosphere, isCosmicStyle, smooth } from './cosmicMotion'
import { createSceneLighting } from './sceneLighting'
import { createCosmicTravel } from './cosmicTravel'

export const SCENE_TOGGLE_EVENT = 'sub2api-ops:scene-toggle'
const controls = 'a, button, input, textarea, select, label, nav, .workspace-bar, .mobile-bar, aside, [contenteditable], [role="dialog"], [role="tablist"], [role="slider"], [role="button"], [role="tooltip"], .table-scroll'
type InteractiveStyle = Exclude<VisualStyle, 'orbital'>

/** One input state drives geometry and light. Renderers own their single frame loop. */
export function createSceneInteraction(style: InteractiveStyle, reduced: boolean) {
  let progress = reduced ? (isCosmicStyle(style) ? 1 : 0.45) : 0
  let target = progress
  const travel = isCosmicStyle(style) && !reduced ? createCosmicTravel(progress, style === 'moon' ? 8500 : 11_200) : null
  let x = 0.58, y = 0.5, targetX = x, targetY = y
  let pinned = false
  let lastTime = 0
  let bounds = { left: 0, top: 0, width: 1, height: 1 }
  let host: HTMLElement | null = null
  let lights: ReturnType<typeof createSceneLighting>[] = []
  const center = (width: number) => {
    if (style === 'moon') return { x: 0.78, y: 0.22 }
    if (style === 'galaxy' || style === 'nebula') return { x: width < 820 ? 0.65 : 0.74, y: width < 820 ? 0.23 : style === 'galaxy' ? (width < 1150 ? 0.26 : 0.34) : 0.3 }
    if (style === 'lighttunnel') return { x: 0.54, y: 0.47 }
    return { x: 0.77, y: 0.31 }
  }
  const settled = () => Math.abs(progress - target) < 0.0001 && (!travel || travel.atRest()) && Math.abs(x - targetX) + Math.abs(y - targetY) < 0.0001
  const control = {
    wake: null as (() => void) | null,
    center,
    settled,
    current: () => ({ progress, x, y }),
    resetClock() { lastTime = 0 },
    sample(time: number) {
      const delta = lastTime ? Math.min(80, Math.max(0, time - lastTime)) : 16.67
      lastTime = time
      if (!reduced) {
        // Bound travel speed so rapid reversals cannot flash through a stellar burst.
        const cosmic = isCosmicStyle(style)
        const distance = (target - progress) * (1 - Math.exp(-delta / (cosmic ? 440 : 220)))
        const limit = delta / (cosmic ? 3000 : 900)
        if (travel) progress = travel.step(target, delta)
        else {
          progress += Math.max(-limit, Math.min(limit, distance))
          if (Math.abs(target - progress) < 0.001) progress = target
        }
        const follow = 1 - Math.exp(-delta / 170)
        x += (targetX - x) * follow
        y += (targetY - y) * follow
        if (Math.abs(targetX - x) + Math.abs(targetY - y) < 0.0001) { x = targetX; y = targetY }
      }
      lights[0]?.update(progress, time)
      if (isCosmicStyle(style)) {
        const atmosphere = cosmicAtmosphere(style, progress)
        lights[1]?.update(atmosphere.light, time)
        lights[2]?.update(atmosphere.warmth, time)
        lights[3]?.update(progress, time)
      }
      if (host) {
        const label = progress.toFixed(3)
        if (host.dataset.sceneProgress !== label) host.dataset.sceneProgress = label
        if (host.dataset.sceneHeld !== String(pinned)) host.dataset.sceneHeld = String(pinned)
      }
      return { progress, x, y }
    },
    connect(element: HTMLElement) {
      host = element
      const root = document.documentElement
      lights = [createSceneLighting(root, '--scene-engagement')]
      if (isCosmicStyle(style)) lights.push(
        createSceneLighting(root, '--cosmic-light'), createSceneLighting(root, '--cosmic-warmth'),
        createSceneLighting(root, '--cosmic-travel'),
      )
      const measure = () => { bounds = element.getBoundingClientRect() }
      measure()
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
      resize?.observe(element)
      if (!resize) window.addEventListener('resize', measure)
      const wake = () => { if (!reduced && !document.hidden && !settled()) control.wake?.() }
      const retreat = () => {
        if (reduced) return
        if (!pinned) target = 0
        targetX = 0.58; targetY = 0.5
        wake()
      }
      const move = (event: PointerEvent) => {
        if (reduced || document.hidden || bounds.width <= 0 || bounds.height <= 0) return
        if (event.target instanceof Element && event.target.closest(controls)) { retreat(); return }
        targetX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
        targetY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
        const origin = center(bounds.width)
        const radius = Math.min(bounds.width * 0.36, bounds.height * 0.38)
        const distance = Math.hypot((targetX - origin.x) * bounds.width, (targetY - origin.y) * bounds.height) / radius
        if (!pinned) target = 1 - smooth(0.2, 1, distance)
        wake()
      }
      const release = (event: PointerEvent) => { if (event.pointerType !== 'mouse') retreat() }
      const toggle = () => {
        if (reduced) return
        pinned = !pinned
        target = pinned ? 1 : 0
        wake()
      }
      const visibility = () => { control.resetClock() }
      window.addEventListener('pointermove', move, { passive: true })
      window.addEventListener('pointerdown', move, { passive: true })
      window.addEventListener('pointerup', release, { passive: true })
      window.addEventListener('pointercancel', retreat, { passive: true })
      // pointerleave does not bubble; observe the document boundary as well as the window.
      document.documentElement.addEventListener('pointerleave', retreat, { passive: true })
      window.addEventListener('pointerleave', retreat, { passive: true })
      window.addEventListener('blur', retreat)
      window.addEventListener(SCENE_TOGGLE_EVENT, toggle)
      document.addEventListener('visibilitychange', visibility)
      control.sample(performance.now())
      return () => {
        resize?.disconnect()
        window.removeEventListener('resize', measure)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerdown', move)
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', retreat)
        document.documentElement.removeEventListener('pointerleave', retreat)
        window.removeEventListener('pointerleave', retreat)
        window.removeEventListener('blur', retreat)
        window.removeEventListener(SCENE_TOGGLE_EVENT, toggle)
        document.removeEventListener('visibilitychange', visibility)
        lights.forEach(light => light.dispose())
        lights = []
        host = null
      }
    },
  }
  return control
}
export type SceneInteraction = ReturnType<typeof createSceneInteraction>
