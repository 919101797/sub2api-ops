import { getMoonCloudTexture, hash } from './cosmicTextures'
import type { MoonFrame } from './moonFrame'
import type { moonStory } from './moonStory'

export function drawEraClouds(ctx: CanvasRenderingContext2D, w: number, h: number, frame: MoonFrame, story: ReturnType<typeof moonStory>) {
  if (story.clouds < 0.001) return
  const cloud = getMoonCloudTexture()
  if (!cloud.complete || !cloud.naturalWidth) return
  const passY = frame.traveler.y + (story.cloudPass - 0.5) * h * 0.84
  ctx.save()
  for (let i = 0; i < 12; i++) {
    const depth = 0.4 + hash(i, 73) * 0.6
    const width = Math.max(w * 0.3, h * 0.36) * (0.85 + depth * 0.5)
    const height = width * cloud.naturalHeight / cloud.naturalWidth
    const x = w * (0.63 + hash(i, 61) * 0.35) + (story.cloudPass - 0.5) * width * depth * 0.24
    const y = passY + (hash(i, 83) - 0.5) * h * 0.16 + (story.cloudPass - 0.5) * h * depth * 0.08
    ctx.globalAlpha = story.clouds * (0.45 + depth * 0.26)
    ctx.drawImage(cloud, x - width / 2, y - height / 2, width, height)
  }
  ctx.restore()
}
