import { rgba, type MotionState, type Palette } from './types'

export function drawQuantum(
  context: CanvasRenderingContext2D,
  motion: MotionState,
  width: number,
  height: number,
  time: number,
  palette: Palette,
) {
  const gathering = motion.sceneProgress
  const colors = [palette.accent, palette.secondary, palette.tertiary]
  context.save()
  context.lineCap = 'round'
  const lift = (motion.y - 0.5) * height * 0.22
  const drift = (motion.x - 0.5) * width * 0.08
  for (let ribbon = 0; ribbon < 3; ribbon += 1) {
    const phase = time * 0.00012 + ribbon * 1.8
    const base = height * (0.47 + ribbon * 0.21 * (1 - gathering * 0.75))
    const gradient = context.createLinearGradient(0, height, width, 0)
    gradient.addColorStop(0, rgba(colors[ribbon]!, 0))
    gradient.addColorStop(0.18, rgba(colors[ribbon]!, 0.24))
    gradient.addColorStop(0.48, rgba(colors[(ribbon + 1) % 3]!, 0.66))
    gradient.addColorStop(0.76, rgba(palette.tertiary, 0.75))
    gradient.addColorStop(1, rgba(colors[ribbon]!, 0.08))
    const trace = (strand: number) => {
      const spread = (strand - 14) * height * (0.008 - gathering * 0.005)
      context.beginPath()
      context.moveTo(-width * 0.15, base + spread + height * 0.18)
      context.bezierCurveTo(
        width * 0.24 + drift,
        base - height * 0.38 + Math.sin(phase + strand * 0.08) * height * 0.14 + spread - lift,
        width * (0.65 + gathering * 0.13),
        base + height * (0.18 - gathering * 0.32) + Math.cos(phase + strand * 0.045) * height * 0.19 + spread + lift,
        width * 1.15,
        height * (-0.18 + ribbon * 0.09) + spread,
      )
    }
    trace(14)
    context.strokeStyle = gradient
    context.globalAlpha = 0.08 + gathering * 0.15
    context.lineWidth = 46 + motion.energy * 24
    context.stroke()
    for (let strand = 0; strand < 30; strand += 1) {
      trace(strand)
      context.globalAlpha = (0.2 + Math.sin((strand / 29) * Math.PI) * 0.62) * (palette.dark ? 1 : 0.65)
      context.lineWidth = strand % 7 === 0 ? 2 : 0.75
      context.stroke()
    }
  }
  context.globalAlpha = 1
  for (let particle = 0; particle < 32; particle += 1) {
    const progress = (time * 0.000025 + particle * 0.037) % 1
    const x = progress * width
    const y = height * (0.2 + (particle % 7) * 0.1) + Math.sin(progress * 5 + particle) * height * 0.14
    const radius = particle % 5 === 0 ? 1.6 : 0.7
    context.fillStyle = rgba(palette.tertiary, 0.16 + Math.sin(progress * Math.PI) * 0.42)
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}
