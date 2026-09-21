import { blend, hash, getNebulaTexture, getNuwaTexture, getMoonCloudTexture } from './cosmicTextures'
import { drawStars, glow } from './cosmicDrawing'
import { mendingStory, mendingSeam, mendingStar, mendingThread, mendingDestination, stonePoint, repairAt, mythFrame, MENDING_PALM, storyEase } from './mythStory'
import { mythSpark, mythTexture, traceStoryPath } from './mythDrawing'
import { rgba, type DrawScene, type Palette } from './types'

const jade: Palette['accent'] = [130, 198, 178], pearl: Palette['accent'] = [232, 235, 208]
const stoneColors: Palette['accent'][] = [[145, 211, 182], [231, 198, 129], [204, 157, 140], [226, 232, 218], [148, 186, 216]]

function riftEdge(t: number, side: number, p: number) {
  const q = mendingSeam(t), width = Math.sin(t * Math.PI) ** 0.7
    * (0.075 + 0.024 * Math.sin(t * Math.PI * 9) + 0.012 * Math.sin(t * Math.PI * 27)) * (1 - repairAt(t, p))
  return { x: q.x, y: q.y + side * width }
}

export const drawNebula: DrawScene = (ctx, motion, w, h, time, palette) => {
  const p = motion.sceneProgress, story = mendingStory(p), frame = mythFrame('nebula', p, w, h)
  const radius = frame.radius * frame.scale
  drawStars(ctx, motion, w, h, time, palette)
  ctx.save(); ctx.translate(frame.x + (motion.x - 0.5) * 16, frame.y + (motion.y - 0.5) * 10)
  ctx.rotate(frame.angle); ctx.scale(radius, radius)
  const texture = getNebulaTexture()
  ctx.save(); ctx.rotate(-0.12 + story.weave * 0.07)
  mythTexture(ctx, texture, -2.0, -1.15, 3.8, 2.3, palette.dark ? 0.76 : 0.52)
  ctx.restore()
  ctx.save(); ctx.rotate(0.34 - story.weave * 0.18)
  mythTexture(ctx, texture, -1.4, -0.9, 2.9, 1.8, 0.24); ctx.restore()

  // The hole is the same path at every stage; its banks close behind the arriving threads.
  ctx.beginPath()
  for (let i = 0; i <= 96; i++) { const q = riftEdge(i / 96, -1, p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y) }
  for (let i = 96; i >= 0; i--) { const q = riftEdge(i / 96, 1, p); ctx.lineTo(q.x, q.y) }
  ctx.closePath()
  const depth = ctx.createLinearGradient(0, -0.6, 0, 0.1)
  depth.addColorStop(0, palette.dark ? '#102329' : '#496365')
  depth.addColorStop(0.5, palette.dark ? '#040a11' : '#243c48')
  depth.addColorStop(1, palette.dark ? '#0c1c23' : '#46635f')
  ctx.fillStyle = depth; ctx.fill()
  ctx.save(); ctx.clip()
  for (let i = 0; i < 70; i++) {
    const q = mendingSeam(hash(i, 211))
    ctx.fillStyle = rgba([155, 189, 209], 0.1 + hash(i, 65) * 0.18)
    ctx.fillRect(q.x, q.y + (hash(i, 156) - 0.5) * 0.12, 0.75 / radius, 0.75 / radius)
  }
  ctx.restore()
  for (const side of [-1, 1]) {
    for (let bank = 0; bank < 4; bank++) {
      traceStoryPath(ctx, t => { const q = riftEdge(t, side, p); return { x: q.x, y: q.y + side * bank * 0.005 } })
      ctx.strokeStyle = rgba(jade, (0.38 - bank * 0.075) * (1 - story.restored * 0.8))
      ctx.lineWidth = (bank ? 1 : 1.6) / radius; ctx.stroke()
    }
  }
  for (let i = 0; i < 420; i++) {
    const t = hash(i, 171), side = i % 2 ? 1 : -1, q = riftEdge(t, side, p)
    const flow = story.collect * (1 - story.weave) * 0.04
    const x = q.x + (hash(i, 65) - 0.5) * 0.27, y = q.y + side * hash(i, 74) * 0.16 + flow
    ctx.fillStyle = rgba(palette.dark ? jade : [54, 105, 93], (0.08 + hash(i, 22) * 0.29) * (1 - story.restored * 0.3))
    ctx.fillRect(x, y, 0.85 / radius, 0.85 / radius)
  }

  // Palm placement comes from the alpha asset's actual open-hand anchor.
  if (story.figure > 0.001) {
    const figureWidth = 0.98, figureHeight = figureWidth * 1.5
    mythTexture(ctx, getNuwaTexture(), MENDING_PALM.x - figureWidth * 0.153,
      MENDING_PALM.y - figureHeight * 0.139, figureWidth, figureHeight, story.figure * 0.68)
  }
  glow(ctx, MENDING_PALM.x, MENDING_PALM.y - 0.065, 0.42, pearl, story.forge * 0.12)

  for (let id = 0; id < 48; id++) {
    const point = mendingStar(id, p), previous = mendingStar(id, Math.max(0, p - 0.025))
    const tint = stoneColors[id % 5]!, t = (id + 0.5) / 48
    const thread = storyEase(0.44 + t * 0.2, 0.62 + t * 0.22, p)
    const repair = repairAt(t, p)
    // A thread grows from the very stone that the falling star became.
    if (thread > 0.001 && repair < 0.999) {
      traceStoryPath(ctx, q => mendingThread(id, q), 0, thread, 36)
      ctx.strokeStyle = rgba(tint, (1 - repair) * 0.38)
      ctx.lineWidth = (id % 4 ? 0.7 : 1.25) / radius; ctx.stroke()
    }
    const moving = Math.hypot(point.x - previous.x, point.y - previous.y)
    if (moving > 0.0001) {
      ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(point.x, point.y)
      ctx.strokeStyle = rgba(tint, 0.38); ctx.lineWidth = 1 / radius; ctx.stroke()
    }
    const alpha = (0.48 + hash(id, 18) * 0.38) * (1 - story.forge * 0.25)
    mythSpark(ctx, point, radius, blend(tint, pearl, repair), alpha, 1.05 + hash(id, 51) * 0.65 + repair * 0.3)
  }

  // Five stones are drawn at the same five particle gathering points, never introduced elsewhere.
  const stones = storyEase(0.2, 0.35, p) * (1 - storyEase(0.5, 0.7, p))
  if (stones > 0.001) for (let id = 0; id < 5; id++) {
    const q = stonePoint(id), color = stoneColors[id]!, size = 0.01 + story.forge * 0.004
    glow(ctx, q.x, q.y, size * 4, color, stones * 0.36)
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(id * 0.7 + story.collect * 0.3)
    ctx.beginPath(); ctx.moveTo(-size, -size * 0.55); ctx.lineTo(size * 0.2, -size)
    ctx.lineTo(size, size * 0.15); ctx.lineTo(size * 0.3, size); ctx.lineTo(-size, size * 0.4); ctx.closePath()
    const crystal = ctx.createLinearGradient(-size, -size, size, size)
    crystal.addColorStop(0, rgba(pearl, stones)); crystal.addColorStop(0.35, rgba(color, stones))
    crystal.addColorStop(1, rgba(blend(color, [27, 50, 57], 0.72), stones))
    ctx.fillStyle = crystal; ctx.fill()
    ctx.strokeStyle = rgba(pearl, stones * 0.4); ctx.lineWidth = 0.65 / radius; ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-size, -size * 0.55); ctx.lineTo(0, 0); ctx.lineTo(size, size * 0.15)
    ctx.strokeStyle = rgba([255, 250, 225], stones * 0.6); ctx.stroke(); ctx.restore()
  }

  // Cross-stitches appear only after their light has reached the original banks.
  for (let stitch = 0; stitch < 54; stitch++) {
    const t = (stitch + 0.5) / 54, repaired = repairAt(t, p)
    if (repaired < 0.001) continue
    const a = mendingSeam(Math.max(0, t - 0.016)), b = mendingSeam(Math.min(1, t + 0.016))
    const width = 0.034 * Math.sin(Math.PI * t)
    ctx.beginPath(); ctx.moveTo(a.x, a.y - width); ctx.bezierCurveTo(a.x, a.y + width, b.x, b.y - width, b.x, b.y + width)
    ctx.strokeStyle = rgba(blend(stoneColors[stitch % 5]!, pearl, story.restored), repaired * 0.45 * (1 - story.restored * 0.94))
    ctx.lineWidth = 0.9 / radius; ctx.stroke()
  }
  if (story.restored > 0.001) for (let cloud = 0; cloud < 9; cloud++) {
    const q = mendingSeam((cloud + 0.5) / 9)
    glow(ctx, q.x, q.y, 0.13 + hash(cloud, 66) * 0.1, jade, story.restored * 0.12)
  }
  for (let i = 0; i < 380; i++) {
    const t = hash(i, 153), q = mendingSeam(t), reveal = repairAt(t, p)
    const x = q.x + (hash(i, 71) - 0.5) * 0.2, y = q.y + (hash(i, 122) - 0.5) * 0.42
    ctx.fillStyle = rgba(palette.dark ? pearl : [55, 107, 96], reveal * (0.12 + hash(i, 34) * 0.55))
    ctx.fillRect(x, y, 0.9 / radius, 0.9 / radius)
  }
  // Foreground vapour rises over the robe as Nuwa withdraws, preserving the sky behind her.
  const withdraw = storyEase(0.72, 0.96, p)
  mythTexture(ctx, getMoonCloudTexture(), -1.55, 0.7 - withdraw * 0.58, 3.3, 1.35, 0.1 + withdraw * 0.14)
  ctx.save(); ctx.rotate(-0.15)
  mythTexture(ctx, texture, -1.7, 0.04 + story.collect * 0.15 - withdraw * 0.3, 3.4, 1.6, 0.12 + withdraw * 0.2)
  ctx.restore()
  glow(ctx, mendingDestination(24).x, mendingDestination(24).y, 1.3, jade, story.restored * 0.06)
  ctx.restore()
}
