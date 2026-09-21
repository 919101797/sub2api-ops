import { hash } from './cosmicTextures'
import { rgba, type DrawScene, type Palette } from './types'
export const TAU = Math.PI * 2
export const stars = Array.from({ length: 170 }, (_, i) => ({
  x: hash(i, 4),
  y: hash(i, 9),
  z: hash(i, 18),
  r: hash(i, 22),
}))
export function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: Palette['accent'],
  alpha: number,
) {
  if (r <= 0 || alpha < 0.001) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, rgba(color, alpha))
  g.addColorStop(0.2, rgba(color, alpha * 0.45))
  g.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}
export const drawStars: DrawScene = (ctx, motion, width, height, _time, palette) => {
  for (const s of stars) {
    const depth = motion.sceneProgress * s.z
    const x = (s.x * width + (s.x - 0.75) * depth * width * 0.12 + (motion.x - 0.5) * s.z * 14 + width) % width
    const y = (s.y * height + (s.y - 0.35) * depth * height * 0.09 + (motion.y - 0.5) * s.z * 10 + height) % height
    ctx.fillStyle = rgba(palette.dark ? [218, 230, 235] : [46, 74, 90], 0.1 + s.r * 0.5)
    ctx.fillRect(x, y, s.r > 0.94 ? 1.7 : 1.05, s.r > 0.94 ? 1.7 : 1.05)
  }
}
export function star(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: Palette['accent'],
  alpha: number,
) {
  glow(ctx, x, y, size * 5, color, alpha * 0.15)
  ctx.strokeStyle = rgba(color, alpha * 0.44)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(x - size * 5, y)
  ctx.lineTo(x + size * 5, y)
  ctx.moveTo(x, y - size * 5)
  ctx.lineTo(x, y + size * 5)
  ctx.stroke()
  ctx.fillStyle = rgba(color, alpha)
  ctx.beginPath()
  ctx.arc(x, y, size, 0, TAU)
  ctx.fill()
}
