import { getMoonTexture, getEarthTexture, getGroundTexture, getChangeTexture, getPalaceTexture, getRocketTexture, hash } from './cosmicTextures'
import { moonStory } from './moonStory'
import { moonFrame, lunarHorizon } from './moonFrame'
import { drawLunarVehicle, drawLaunchClouds } from './lunarFlight'
import { drawEraClouds } from './moonClouds'
import { glow, drawStars, TAU } from './cosmicDrawing'
import { rgba, type DrawScene } from './types'

export const drawMoon: DrawScene = (ctx, motion, w, h, time, palette) => {
  const p = motion.sceneProgress, story = moonStory(p), frame = moonFrame(p, w, h)
  const px = (motion.x - 0.5) * 20, py = (motion.y - 0.5) * 12
  frame.traveler.x += px; frame.traveler.y += py
  frame.moon.x += px * 0.3; frame.moon.y += py * 0.3
  const narrow = w < 820
  drawStars(ctx, motion, w, h, time, palette)

  // Earth travels continuously behind the lunar limb: its rise is revealed by actual occlusion.
  if (frame.earth.opacity > 0.001) {
    const earth = getEarthTexture(), { x, y, radius, opacity } = frame.earth
    ctx.save(); ctx.globalAlpha = opacity
    glow(ctx, x, y, radius * 1.16, [108, 191, 222], 0.18)
    if (earth.complete && earth.naturalWidth) ctx.drawImage(earth, x - radius, y - radius, radius * 2, radius * 2)
    ctx.restore()
  }

  if (story.surface < 1) {
    const { x, y, radius: r } = frame.moon
    ctx.save()
    glow(ctx, x, y, r * 1.4, [219, 224, 207], (1 - story.cruise) * 0.065)
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip()
    // An opaque lunar body also occludes Earth while the camera turns home.
    ctx.fillStyle = '#323c42'; ctx.fillRect(x - r, y - r, r * 2, r * 2)
    const moon = getMoonTexture()
    if (moon.complete && moon.naturalWidth) ctx.drawImage(moon, x - r, y - r, r * 2, r * 2)
    const shade = ctx.createLinearGradient(x - r, y, x + r, y)
    shade.addColorStop(0, '#061321a0'); shade.addColorStop(0.48, '#10202a28'); shade.addColorStop(1, '#b4d0dc00')
    ctx.fillStyle = shade; ctx.fillRect(x - r, y - r, r * 2, r * 2)
    ctx.restore()
  }

  if (story.myth > 0.001) {
    ctx.save()
    ctx.globalAlpha = story.myth * (palette.dark ? 0.78 : 0.7) * (narrow ? 0.75 : 1)
    const palace = getPalaceTexture(), plateWidth = Math.max(w * 1.06, h * 1.9), plateHeight = plateWidth * 2 / 3
    if (palace.complete && palace.naturalWidth)
      ctx.drawImage(palace, w - plateWidth + px * 0.2, h - plateHeight + story.ascent * h * 0.12, plateWidth, plateHeight)
    ctx.restore()
  }

  if (story.atmosphere > 0.001) {
    ctx.save(); ctx.globalAlpha = story.atmosphere
    const r = Math.max(w * 0.85, h * 1.3), cx = w * 0.48 + px * 0.3
    const cy = r + h * (0.65 + story.launch * 0.38)
    const atmosphere = ctx.createRadialGradient(cx, cy, r * 0.984, cx, cy, r * 1.036)
    atmosphere.addColorStop(0, '#0c2338'); atmosphere.addColorStop(0.25, '#21405b')
    atmosphere.addColorStop(0.38, '#8cdaeebd'); atmosphere.addColorStop(0.53, '#477fa954'); atmosphere.addColorStop(1, '#172e4b00')
    ctx.fillStyle = atmosphere; ctx.fillRect(0, 0, w, h)
    const engineY = frame.traveler.y + frame.vehicleLength * 1190 / 1536
    glow(ctx, frame.traveler.x, engineY, w * 0.32, [244, 179, 104], story.ignition * (1 - story.launch) * 0.26)
    drawLaunchClouds(ctx, frame.traveler.x, engineY, Math.min(w * 0.23, h * 0.18), story.ignition, story.ignition * (1 - story.launch) ** 2)
    ctx.restore()
  }

  // One light trail carries the eye through the era change and remains aligned with the cabin.
  if (story.cruise < 1) {
    ctx.save(); ctx.globalAlpha = (1 - story.cruise) * (0.1 + story.ascent * 0.12 + story.clouds * 0.15)
    const { x, y } = frame.traveler
    const light = ctx.createLinearGradient(x, h * 0.85, x, y)
    light.addColorStop(0, '#dac8a100'); light.addColorStop(0.45, '#e4cfa2'); light.addColorStop(1, '#f4efdd')
    ctx.strokeStyle = light
    for (let strand = 0; strand < 6; strand++) {
      const offset = (strand - 3) * 2.5
      ctx.lineWidth = strand % 2 ? 0.6 : 1.25
      ctx.beginPath(); ctx.moveTo(x - w * 0.15, h * 0.87)
      ctx.bezierCurveTo(x + w * 0.1 + offset, h * 0.68, x - w * 0.11 - offset, h * 0.43, x, y)
      ctx.stroke()
    }
    glow(ctx, x, y, Math.min(w * 0.13, h * 0.2), [244, 230, 196], story.clouds * 0.28)
    ctx.restore()
  }

  if (story.myth > 0.001) {
    const change = getChangeTexture()
    const width = Math.min(w * (narrow ? 0.58 : 0.52), h * 0.77) * (1 - story.ascent * 0.09), height = width * 2 / 3
    ctx.save(); ctx.globalAlpha = story.myth
    ctx.translate(frame.traveler.x, frame.traveler.y); ctx.rotate(-story.ascent * 0.045)
    if (change.complete && change.naturalWidth) ctx.drawImage(change, -width * 0.735, -height * 0.15, width, height)
    ctx.restore()
  }
  drawLunarVehicle(ctx, getRocketTexture(), frame, story, p)
  drawEraClouds(ctx, w, h, frame, story)

  if (story.surface > 0.001) {
    const top = frame.moon.y - frame.moon.radius
    ctx.save(); ctx.globalAlpha = story.surface
    ctx.beginPath(); ctx.moveTo(0, lunarHorizon(frame.moon, 0))
    for (let i = 0; i <= 100; i++) {
      const x = i / 100 * w
      const ridge = (Math.sin(i * 0.18) * 3 + Math.sin(i * 0.57) + hash(i, 71)) * story.surface
      ctx.lineTo(x, lunarHorizon(frame.moon, x) + ridge)
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.clip()
    const ground = getGroundTexture(), zoom = 1.05 + (1 - story.surface) * 0.12
    if (ground.complete && ground.naturalWidth)
      ctx.drawImage(ground, w * (1 - zoom) / 2 + px * 0.15, top - 18, w * zoom, h - top + 18)
    const shade = ctx.createLinearGradient(0, top, 0, h)
    shade.addColorStop(0, '#dce0d016'); shade.addColorStop(0.35, '#14202a0d'); shade.addColorStop(1, '#0a121f75')
    ctx.fillStyle = shade; ctx.fillRect(0, top - 18, w, h)
    ctx.restore()
    glow(ctx, frame.traveler.x, h * 0.82, w * 0.24, [207, 198, 170], story.surface * (1 - story.earthrise) * 0.12)
  }
}
