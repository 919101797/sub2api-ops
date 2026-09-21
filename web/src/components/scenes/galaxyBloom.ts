import { blend, hash, getPanguTexture, getStarVeilTexture } from './cosmicTextures'
import { drawStars, glow } from './cosmicDrawing'
import { creationStory, creationDust, mythFrame } from './mythStory'
import { mythSpark, mythTexture, traceStoryPath } from './mythDrawing'
import { rgba, type DrawScene, type Palette } from './types'

const silver: Palette['accent'] = [185, 217, 242]
const pearl: Palette['accent'] = [243, 235, 217]

export const drawGalaxy: DrawScene = (ctx, motion, w, h, time, palette) => {
  const p = motion.sceneProgress, story = creationStory(p), frame = mythFrame('galaxy', p, w, h)
  const radius = frame.radius * frame.scale
  drawStars(ctx, motion, w, h, time, palette)
  ctx.save(); ctx.translate(frame.x + (motion.x - 0.5) * 12, frame.y + (motion.y - 0.5) * 8)
  ctx.rotate(frame.angle); ctx.scale(radius, radius)
  const color = blend(silver, pearl, story.radiance * 0.34)
  glow(ctx, 0, 0, 1.15 + story.bloom * 0.5, silver, 0.06 + story.radiance * 0.035)

  // The luminous heart stays fixed while the same cloud silk slowly opens around it.
  const width = 1.85 + story.bloom * 1.3 + story.galaxy, height = width * 2 / 3
  const veil = getStarVeilTexture()
  ctx.save(); ctx.rotate(0.42 - story.bloom * 0.15)
  mythTexture(ctx, veil, -width * 0.68, -height * 0.3, width * 1.15, height, 0.08)
  ctx.restore()
  mythTexture(ctx, veil, -width * 0.7, -height * 0.36, width, height, palette.dark ? 0.42 + story.bloom * 0.22 : 0.37 + story.bloom * 0.15)

  // Translucent filaments follow the eventual river, instead of an expanding shock ring.
  for (let strand = 0; strand < 7; strand++) {
    traceStoryPath(ctx, t => ({
      x: (t - 0.7) * (1.4 + story.bloom * 2.2),
      y: 0.2 - t * 0.5 + Math.sin(t * Math.PI * 2) * (0.08 + story.bloom * 0.12)
        + (strand - 3) * 0.014 * Math.sin(t * Math.PI) + Math.sin(t * 9 + strand) * 0.007,
    }))
    ctx.strokeStyle = rgba(color, story.radiance * (0.035 + strand % 2 * 0.025))
    ctx.lineWidth = (strand % 2 ? 0.5 : 1) / radius; ctx.stroke()
  }

  // A distant, momentary mythic presence is subordinate to the cloud and starlight.
  if (story.figure > 0.001) {
    mythTexture(ctx, getPanguTexture(), -0.12, -0.35, 0.24, 0.36, story.figure)
  }

  for (let id = 0; id < 950; id++) {
    const q = creationDust(id, p), z = q.glow
    const alpha = (0.12 + z * 0.63) * (0.45 + story.bloom * 0.35)
    const tint = palette.dark ? blend(silver, pearl, hash(id, 118) * 0.35) : [70, 111, 146] as Palette['accent']
    const size = (0.6 + z * 0.7) / radius
    ctx.fillStyle = rgba(tint, alpha); ctx.fillRect(q.x, q.y, size, size)
    if (id % 83 === 0) mythSpark(ctx, q, radius, tint, alpha * 0.9, 0.85 + z * 0.7)
    if (id % 47 === 0 && story.radiance > 0.001) {
      const tail = creationDust(id, Math.max(0, p - 0.02))
      ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(q.x, q.y)
      ctx.strokeStyle = rgba(tint, story.radiance * 0.18); ctx.lineWidth = 0.55 / radius; ctx.stroke()
    }
  }
  glow(ctx, 0, 0, 0.16 + story.radiance * 0.19, pearl, story.radiance * 0.11)
  mythSpark(ctx, { x: 0, y: 0 }, radius, pearl, 0.38 + story.radiance * 0.38, 1.1 + story.radiance * 0.6)
  ctx.restore()
}
