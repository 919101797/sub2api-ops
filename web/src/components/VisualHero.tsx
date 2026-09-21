import { cosmicCanvasResolution } from './scenes/canvasResolution'
import { prepareCosmicTextures } from './scenes/cosmicTextures'
import { drawOrbital } from './scenes/orbital'
import { eclipseDarkness } from './scenes/eclipseLighting'
import { createSceneLighting } from './scenes/sceneLighting'
import { drawMoon, drawGalaxy, drawNebula } from './scenes/cosmic'
import { isCosmicStyle } from './scenes/cosmicMotion'
import { createSceneInteraction } from './scenes/sceneInteraction'
import { drawQuantum } from './scenes/quantum'
import { drawAurora, drawTidal } from './scenes/landscapes'
import { type MotionState, type Palette, type DrawScene } from './scenes/types'
import { lazy, memo, Suspense, useEffect, useMemo, useRef } from 'react'

import { useAppearance, type VisualStyle } from './Appearance'
import { useReducedMotion } from './useReducedMotion'
const ReactBitsScene = lazy(() => import('./ReactBitsScene').then((module) => ({ default: module.ReactBitsScene })))
const isReactBitsStyle = (style: VisualStyle): style is 'ferrofluid' | 'lighttunnel' =>
  style === 'ferrofluid' || style === 'lighttunnel'

type CanvasStyle = Exclude<VisualStyle, 'ferrofluid' | 'lighttunnel'>

const canvasScenes: Record<CanvasStyle, DrawScene> = {
  orbital: drawOrbital,
  quantum: drawQuantum,
  aurora: drawAurora,
  tidal: drawTidal,
  moon: drawMoon,
  galaxy: drawGalaxy,
  nebula: drawNebula,
}
const CANVAS_STYLES = new Set(Object.keys(canvasScenes))
const MAX_CANVAS_PIXELS = 1_600_000
const MAX_PIXEL_RATIO = 1.25

function parseRgb(value: string, fallback: [number, number, number]): [number, number, number] {
  const channels = value.trim().split(/\s+/).map(Number)
  return channels.length === 3 && channels.every(Number.isFinite) ? (channels as [number, number, number]) : fallback
}

export const VisualHero = memo(function VisualHero() {
  const reducedMotion = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const drawOnceRef = useRef<(() => void) | null>(null)
  const boundsRef = useRef({ left: 0, top: 0, width: 0, height: 0 })
  const motionRef = useRef<MotionState>({
    x: 0.58,
    y: 0.5,
    targetX: 0.58,
    targetY: 0.5,
    energy: 0.34,
    focus: false,
    eclipse: 0.46,
    sceneProgress: 0.16,
  })
  const { style, resolvedTheme } = useAppearance()
  const interaction = useMemo(() => style === 'orbital' ? null : createSceneInteraction(style, reducedMotion), [style, reducedMotion])

  useEffect(() => {
    if (interaction && heroRef.current) return interaction.connect(heroRef.current)
  }, [interaction])

  useEffect(() => {
    if (style !== 'orbital') return
    const hero = heroRef.current
    const canvas = canvasRef.current
    if (!hero || !canvas) return
    motionRef.current.eclipse = 0.46
    hero.dataset.eclipseTarget = 'partial'

    const setPointer = (event: PointerEvent) => {
      if (reducedMotion) return
      const cachedBounds = boundsRef.current
      const bounds = cachedBounds.width > 0 && cachedBounds.height > 0 ? cachedBounds : canvas.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
      const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
      const motion = motionRef.current
      const orbitalRadius = Math.min(bounds.width * 0.25, bounds.height * 0.29)
      const orbitalCenterX = 0.77
      const orbitalCenterY = 0.31
      const orbitalFocus =
        style === 'orbital' &&
        Math.hypot(
          (x - orbitalCenterX) / Math.max((orbitalRadius / bounds.width) * 1.08, 0.001),
          (y - orbitalCenterY) / Math.max((orbitalRadius / bounds.height) * 1.08, 0.001),
        ) <= 1
      motion.targetX = x
      motion.targetY = y
      motion.focus = orbitalFocus
      hero.dataset.eclipseTarget = orbitalFocus ? 'totality' : 'partial'
      drawOnceRef.current?.()
    }

    const pressPointer = (event: PointerEvent) => {
      if (reducedMotion) return
      setPointer(event)
      drawOnceRef.current?.()
    }

    const releasePointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        motionRef.current.focus = false
        hero.dataset.eclipseTarget = 'partial'
      }
    }

    const resetPointer = () => {
      const motion = motionRef.current
      motion.targetX = 0.58
      motion.targetY = 0.5
      motion.focus = false
      hero.dataset.eclipseTarget = 'partial'
    }

    window.addEventListener('pointermove', setPointer, { passive: true })
    window.addEventListener('pointerdown', pressPointer, { passive: true })
    window.addEventListener('pointerup', releasePointer, { passive: true })
    window.addEventListener('pointercancel', releasePointer, { passive: true })
    window.addEventListener('pointerleave', resetPointer, { passive: true })
    window.addEventListener('blur', resetPointer)
    return () => {
      motionRef.current.focus = false
      hero.dataset.eclipseTarget = 'partial'
      window.removeEventListener('pointermove', setPointer)
      window.removeEventListener('pointerdown', pressPointer)
      window.removeEventListener('pointerup', releasePointer)
      window.removeEventListener('pointercancel', releasePointer)
      window.removeEventListener('pointerleave', resetPointer)
      window.removeEventListener('blur', resetPointer)
    }
  }, [style, reducedMotion])

  useEffect(() => {
    if (!CANVAS_STYLES.has(style) || typeof CanvasRenderingContext2D === 'undefined') return
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const scene = style as CanvasStyle
    const cosmic = isCosmicStyle(scene) ? scene : null
    let texturesReady = !cosmic
    const lighting = scene === 'orbital' ? createSceneLighting(document.documentElement, '--eclipse-darkness') : null
    let disposed = false
    let lastPaint = 0
    let animationFrame = 0
    let running = false
    let width = 0
    let height = 0
    let lastFrameTime = 0
    let sceneTime = 0

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      boundsRef.current = { left: bounds.left, top: bounds.top, width, height }
      const pixelBudgetRatio = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(width * height, 1))
      const ratio = cosmic
        ? cosmicCanvasResolution(width, height, window.devicePixelRatio).ratio
        : Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO, pixelBudgetRatio)
      const pixelWidth = Math.floor(width * ratio)
      const pixelHeight = Math.floor(height * ratio)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.imageSmoothingQuality = 'high'
    }

    const drawFrame = (time: number) => {
      const motion = motionRef.current
      const frameDelta = lastFrameTime > 0 ? Math.min(cosmic ? 80 : 42, Math.max(0, time - lastFrameTime)) : 16.67
      lastFrameTime = time
      sceneTime += frameDelta
      const eclipseTarget = reducedMotion
        ? 0.78
        : scene === 'orbital' && motion.focus
          ? 0.999
          : 0.46 + Math.sin(sceneTime * 0.00022) * 0.1
      const eclipseResponse = motion.focus ? 420 : 640
      motion.eclipse = reducedMotion
        ? eclipseTarget
        : motion.eclipse + (eclipseTarget - motion.eclipse) * (1 - Math.exp(-frameDelta / eclipseResponse))
      if (interaction) {
        const frame = texturesReady ? interaction.sample(time) : interaction.current()
        motion.sceneProgress = frame.progress
        motion.x = frame.x
        motion.y = frame.y
        motion.energy = 0.3 + frame.progress * 0.65
      } else {
        lighting?.update(eclipseDarkness(motion.eclipse) / 100, time)
        const hero = heroRef.current
        if (hero) hero.dataset.eclipseProgress = motion.eclipse.toFixed(2)
        motion.x += (motion.targetX - motion.x) * 0.075
        motion.y += (motion.targetY - motion.y) * 0.075
        motion.energy = 0.2 + (1 - motion.eclipse) * 0.16
      }
      context.clearRect(0, 0, width, height)
      context.save()
      context.globalCompositeOperation = 'source-over'
      canvasScenes[scene](context, motion, width, height, reducedMotion ? 0 : interaction ? motion.sceneProgress * 14_000 : sceneTime, palette)
      context.restore()
    }

    const computed = getComputedStyle(canvas)
    const palette: Palette = {
      accent: parseRgb(computed.getPropertyValue('--accent-rgb'), [118, 91, 196]),
      secondary: parseRgb(computed.getPropertyValue('--skin-secondary-rgb'), [94, 181, 196]),
      tertiary: parseRgb(computed.getPropertyValue('--skin-tertiary-rgb'), [244, 218, 255]),
      ink: resolvedTheme === 'dark' ? [244, 244, 241] : [22, 24, 27],
      dark: resolvedTheme === 'dark',
    }

    const tick = (time: number) => {
      if (!running) return
      if (!interaction || time - lastPaint >= 1000 / 30 - 1) {
        drawFrame(time)
        lastPaint = time
        if (interaction?.settled()) {
          running = false
          animationFrame = 0
          return
        }
      }
      animationFrame = window.requestAnimationFrame(tick)
    }

    const startAnimation = () => {
      if (!texturesReady || reducedMotion || running || document.visibilityState === 'hidden' || interaction?.settled()) return
      running = true
      lastFrameTime = 0
      interaction?.resetClock()
      animationFrame = window.requestAnimationFrame(tick)
    }

    const stopAnimation = () => {
      if (!running && !animationFrame) return
      running = false
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
    }

    const handleResize = () => {
      resize()
      drawFrame(performance.now())
      if (!reducedMotion) startAnimation()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopAnimation()
      else {
        lastFrameTime = 0
        startAnimation()
      }
    }

    if (cosmic)
      void prepareCosmicTextures(cosmic)
        .then(() => {
          if (!disposed) {
            texturesReady = true
            interaction?.resetClock()
            drawFrame(performance.now())
            startAnimation()
          }
        })
        .catch(() => {
          /* The app remains usable if a decorative asset cannot be decoded. */
        })
    resize()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleResize)
    if (resizeObserver) resizeObserver.observe(canvas)
    else window.addEventListener('resize', handleResize, { passive: true })
    document.addEventListener('visibilitychange', handleVisibilityChange)
    drawOnceRef.current = reducedMotion ? null : startAnimation
    if (interaction) interaction.wake = startAnimation
    drawFrame(performance.now())
    if (!reducedMotion) startAnimation()
    return () => {
      disposed = true
      lighting?.dispose()
      if (interaction) interaction.wake = null
      drawOnceRef.current = null
      resizeObserver?.disconnect()
      if (!resizeObserver) window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopAnimation()
    }
  }, [resolvedTheme, style, reducedMotion, interaction])

  const reactBitsStyle = isReactBitsStyle(style) ? style : null
  return (
    <div
      ref={heroRef}
      className="visual-hero"
      data-renderer={reactBitsStyle ? 'react-bits' : 'native-canvas'}
      data-scene={style}
      aria-hidden="true"
    >
      <div className="scene-depth" />
      {reactBitsStyle ? (
        <Suspense fallback={null}>
          <ReactBitsScene key={style} style={reactBitsStyle} theme={resolvedTheme} interaction={interaction!} />
        </Suspense>
      ) : (
        <canvas key={style} ref={canvasRef} />
      )}
      <div className="scene-veil" />
    </div>
  )
})
