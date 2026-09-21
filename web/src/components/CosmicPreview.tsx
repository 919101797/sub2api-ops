import { prepareCosmicTextures } from './scenes/cosmicTextures'
import { useEffect, useRef } from 'react'
import { drawMoon, drawGalaxy, drawNebula } from './scenes/cosmic'
import { type CosmicStyle } from './scenes/cosmicMotion'
const scenes = { moon: drawMoon, galaxy: drawGalaxy, nebula: drawNebula }
export function CosmicPreview({ style }: { style: CosmicStyle }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (typeof CanvasRenderingContext2D === 'undefined') return
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    let disposed = false
    const paint = () => {
      if (disposed) return
      ctx.clearRect(0, 0, 200, 120)
      ctx.save()
      ctx.scale(5 / 6, 5 / 6)
      // Frame the same renderer around its celestial object for the small swatch.
      ctx.translate(-95, 12)
      scenes[style](
        ctx,
        {
          x: 0.5,
          y: 0.5,
          targetX: 0.5,
          targetY: 0.5,
          energy: 0.3,
          focus: false,
          eclipse: 0.46,
          sceneProgress: style === 'galaxy' ? 0.7 : style === 'nebula' ? 0.58 : 0.64,
        },
        300,
        225,
        0,
        {
          dark: true,
          accent: [170, 200, 239],
          secondary: [137, 110, 199],
          tertiary: [225, 230, 249],
          ink: [245, 245, 250],
        },
      )
      ctx.restore()
    }
    void prepareCosmicTextures(style)
      .then(paint)
      .catch(() => {})
    return () => {
      disposed = true
    }
  }, [style])
  return <canvas ref={ref} width={200} height={120} />
}
