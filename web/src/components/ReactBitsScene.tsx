import type { SceneInteraction } from './scenes/sceneInteraction'
import { memo } from 'react'
import { useReducedMotion } from './useReducedMotion'
import Ferrofluid from './open-source/Ferrofluid'
import LightTunnel from './open-source/LightTunnel'

import type { VisualStyle } from './Appearance'

export type ReactBitsStyle = Extract<VisualStyle, 'ferrofluid' | 'lighttunnel'>

export function isReactBitsStyle(style: VisualStyle): style is ReactBitsStyle {
  return style === 'ferrofluid' || style === 'lighttunnel'
}

const fluidPalettes = { dark: ['#f7fbff', '#8ee7ff', '#b8a8ff'], light: ['#172b45', '#315acb', '#008c9b'] }

export const ReactBitsScene = memo(function ReactBitsScene({
  style,
  theme,
  preview = false,
  interaction,
}: {
  style: ReactBitsStyle
  theme: 'light' | 'dark'
  preview?: boolean
  interaction?: SceneInteraction
}) {
  const reducedMotion = useReducedMotion()
  const dpr = preview ? 1.5 : 1.25
  const maxPixelCount = preview ? 24_000 : 1_600_000
  const className = preview
    ? 'react-bits-scene react-bits-scene--preview'
    : 'react-bits-scene react-bits-scene--workspace'

  if (style === 'ferrofluid') {
    return (
      <div className={className} data-react-bits="ferrofluid">
        <Ferrofluid
          {...(interaction ? { interaction } : {})}
          colors={fluidPalettes[theme]}
          dpr={dpr}
          fluidity={0.13}
          flowDirection="down"
          glow={2.3}
          mouseDampening={0.18}
          mouseInteraction={!preview}
          mouseRadius={0.4}
          mouseStrength={1.15}
          maxPixelCount={maxPixelCount}
          opacity={preview ? 1 : 0.9}
          paused={reducedMotion || preview}
          rimWidth={0.23}
          scale={1.45}
          sharpness={3.1}
          shimmer={1.25}
          speed={0.42}
          turbulence={1.15}
        />
      </div>
    )
  }

  return (
    <div className={className} data-react-bits="light-tunnel">
      <LightTunnel
        {...(interaction ? { interaction } : {})}
        brightness={theme === 'dark' ? 1.14 : 0.78}
        cableColor={theme === 'dark' ? '#9aaeff' : '#4258c7'}
        cableCount={24}
        centerX={0.04}
        centerY={-0.03}
        colorVariance
        dpr={dpr}
        fadeFar={2.35}
        fadeNear={0.42}
        flowDirection="outward"
        glow={1.35}
        grain={!preview}
        grainIntensity={0.028}
        mouseInteraction={!preview}
        mouseStrength={0.2}
        maxPixelCount={maxPixelCount}
        opacity={preview ? 1 : 0.9}
        paused={reducedMotion || preview}
        pulseBlend={1.15}
        pulseColor={theme === 'dark' ? '#f8fbff' : '#788dff'}
        pulseLength={0.34}
        pulseSpeed={2.65}
        pulseWidth={0.8}
        rimWidth={0.13}
        size={0.92}
        speed={0.14}
        sway={0.48}
        thickness={0.3}
        tunnelColor={theme === 'dark' ? '#4f46e5' : '#d8dcff'}
        tunnelOpacity={theme === 'dark' ? 0.035 : 0.12}
        waviness={0.38}
      />
    </div>
  )
})
