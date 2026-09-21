import { glow, TAU } from './cosmicDrawing'
import { hash } from './cosmicTextures'
import { rgba } from './types'
import { moonEase, type moonStory } from './moonStory'
import type { MoonFrame } from './moonFrame'

type Story = ReturnType<typeof moonStory>

function exhaust(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, length: number, phase: number) {
  if (length < 1) return
  glow(ctx, x, y + length * 0.14, width * 6, [255, 176, 83], 0.38)
  const plume = ctx.createLinearGradient(x, y, x, y + length)
  plume.addColorStop(0, '#effafff5')
  plume.addColorStop(0.15, '#fff7dcf2')
  plume.addColorStop(0.46, '#ffc678bd')
  plume.addColorStop(0.8, '#ed814a55')
  plume.addColorStop(1, '#e16b3800')
  ctx.fillStyle = plume
  ctx.beginPath()
  ctx.moveTo(x - width, y)
  ctx.bezierCurveTo(x - width * 0.8, y + length * 0.35, x - width * 2, y + length * 0.64, x, y + length)
  ctx.bezierCurveTo(x + width * 2, y + length * 0.7, x + width * 0.9, y + length * 0.35, x + width, y)
  ctx.closePath()
  ctx.fill()
  for (let strand = 0; strand < 11; strand++) {
    const spread = (strand - 5) / 5
    const taper = 0.6 + hash(strand, 79) * 0.4
    ctx.beginPath()
    for (let step = 0; step <= 18; step++) {
      const t = step / 18
      const turbulence = Math.sin(t * 23 + phase * 37 + strand * 1.7) * width * t * 0.26
      const sx = x + spread * width * (1 - t * 0.8) + turbulence
      const sy = y + t * length * taper
      if (step) ctx.lineTo(sx, sy)
      else ctx.moveTo(sx, sy)
    }
    ctx.strokeStyle = rgba(strand % 3 ? [255, 221, 161] : [231, 244, 255], 0.12)
    ctx.lineWidth = width * (0.04 + hash(strand, 93) * 0.09)
    ctx.stroke()
  }
  for (let i = 0; i < 6; i++) {
    const distance = (i + 0.5) / 6
    const stretch = 1 + Math.sin(phase * 24 + i) * 0.1
    ctx.beginPath()
    ctx.ellipse(x, y + distance * length * 0.54, width * (0.8 - distance * 0.5), width * 2 * stretch, 0, 0, TAU)
    ctx.fillStyle = rgba([232, 244, 255], (1 - distance) * 0.68)
    ctx.fill()
  }
}

export function drawLunarVehicle(ctx: CanvasRenderingContext2D, image: HTMLImageElement, frame: MoonFrame, story: Story, progress: number) {
  if (!image.complete || !image.naturalWidth || story.vehicle < 0.001) return
  const length = frame.vehicleLength, scale = length / 1536
  ctx.save()
  ctx.globalAlpha *= story.vehicle
  ctx.translate(frame.traveler.x, frame.traveler.y)
  ctx.rotate(frame.angle)
  // Every part shares the crew cabin's original anchor; no replacement spacecraft appears later.
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.translate(side * story.separation * length * 0.23, story.separation * length * 0.34)
    ctx.rotate(side * story.separation * 0.2)
    ctx.globalAlpha *= 1 - moonEase(0.56, 0.65, progress)
    exhaust(ctx, side * 105 * scale, 1190 * scale, 25 * scale, length * 0.38 * story.ignition * (1 - story.separation * 0.9), progress)
    const sourceX = side < 0 ? 0 : 576
    ctx.drawImage(image, sourceX, 0, 448, 1536, (sourceX - 512) * scale, -280 * scale, 448 * scale, length)
    ctx.restore()
  }
  ctx.save()
  ctx.translate(story.escape * length * 0.18, -story.escape * length * 0.35)
  ctx.globalAlpha *= 1 - story.escape
  ctx.drawImage(image, 448, 0, 128, 190, -64 * scale, -280 * scale, 128 * scale, 190 * scale)
  ctx.restore()
  ctx.save()
  ctx.translate(0, story.core * length * 0.65)
  ctx.globalAlpha *= 1 - story.core
  exhaust(ctx, 0, 1190 * scale, 36 * scale, length * 0.56 * story.ignition * (1 - story.core), progress)
  ctx.drawImage(image, 448, 850, 128, 686, -64 * scale, 570 * scale, 128 * scale, 686 * scale)
  ctx.restore()
  const deploy = moonEase(0.66, 0.76, progress)
  if (deploy > 0.001) {
    ctx.fillStyle = '#20394b'; ctx.strokeStyle = '#91acb9'; ctx.lineWidth = 0.7
    for (const side of [-1, 1]) {
      const panelWidth = length * 0.17 * deploy, panelHeight = length * 0.056
      const x = side < 0 ? -64 * scale - panelWidth : 64 * scale
      ctx.fillRect(x, 285 * scale, panelWidth, panelHeight)
      ctx.strokeRect(x, 285 * scale, panelWidth, panelHeight)
      for (let cell = 1; cell < 7; cell++) {
        ctx.beginPath(); ctx.moveTo(x + cell / 7 * panelWidth, 285 * scale)
        ctx.lineTo(x + cell / 7 * panelWidth, 285 * scale + panelHeight); ctx.stroke()
      }
    }
  }
  if (story.core > 0.001) {
    ctx.save(); ctx.globalAlpha *= story.core
    exhaust(ctx, 0, 575 * scale, 8 * scale, length * 0.1 * (1 - story.cruise), progress)
    ctx.fillStyle = '#283943'
    ctx.beginPath(); ctx.ellipse(0, 575 * scale, 40 * scale, 13 * scale, 0, 0, TAU); ctx.fill()
    ctx.restore()
  }
  ctx.drawImage(image, 448, 190, 128, 660, -64 * scale, -90 * scale, 128 * scale, 660 * scale)
  ctx.restore()
}

export function drawLaunchClouds(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, ignition: number, alpha: number) {
  if (alpha < 0.001) return
  ctx.save()
  for (let i = 0; i < 28; i++) {
    const spread = hash(i, 142)
    const px = x + (hash(i, 55) - 0.5) * radius * (2 + ignition * 3)
    const py = y + (hash(i, 67) - 0.5) * radius * 0.5 + ignition * radius * 0.4
    const size = radius * (0.12 + spread * 0.28)
    const cloud = ctx.createRadialGradient(px - size * 0.2, py - size * 0.4, 0, px, py, size)
    cloud.addColorStop(0, rgba([214, 220, 219], alpha * 0.22))
    cloud.addColorStop(0.6, rgba([137, 161, 168], alpha * 0.14))
    cloud.addColorStop(1, '#78939d00')
    ctx.fillStyle = cloud
    ctx.fillRect(px - size, py - size, size * 2, size * 2)
  }
  ctx.restore()
}
