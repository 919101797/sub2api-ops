import { glow } from './cosmicDrawing'
import { rgba, type Palette } from './types'
import type { StoryPoint } from './mythStory'

export function traceStoryPath(ctx: CanvasRenderingContext2D, point: (t: number) => StoryPoint, from = 0, to = 1, steps = 64) {
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const p = point(from + (to - from) * i / steps)
    if (i) ctx.lineTo(p.x, p.y)
    else ctx.moveTo(p.x, p.y)
  }
}
export function mythTexture(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number, alpha: number) {
  if (alpha < 0.001 || !image.complete || !image.naturalWidth) return
  ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(image, x, y, w, h); ctx.restore()
}
// Draw in scene coordinates while retaining crisp, pixel-sized stellar cores.
export function mythSpark(ctx: CanvasRenderingContext2D, point: StoryPoint, radius: number, color: Palette['accent'], alpha: number, size = 1.3) {
  if (alpha < 0.001) return
  const s = size / radius
  glow(ctx, point.x, point.y, s * 7, color, alpha * 0.25)
  ctx.strokeStyle = rgba(color, alpha * 0.45); ctx.lineWidth = 0.65 / radius
  ctx.beginPath(); ctx.moveTo(point.x - s * 5, point.y); ctx.lineTo(point.x + s * 5, point.y)
  ctx.moveTo(point.x, point.y - s * 5); ctx.lineTo(point.x, point.y + s * 5); ctx.stroke()
  ctx.fillStyle = rgba(color, alpha); ctx.beginPath(); ctx.arc(point.x, point.y, s, 0, Math.PI * 2); ctx.fill()
}
