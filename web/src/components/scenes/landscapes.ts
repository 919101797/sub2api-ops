import { rgba, type DrawScene } from './types'

export const drawAurora: DrawScene = (ctx, motion, width, height, time, palette) => {
  const opening = motion.sceneProgress
  const drift = time * 0.00018
  for (let curtain = 0; curtain < 5; curtain++) {
    const base = width * (0.68 - opening * 0.3 + curtain * (0.06 + opening * 0.11))
    const color = curtain % 2 ? palette.secondary : palette.accent
    const glow = ctx.createLinearGradient(0, 0, 0, height)
    glow.addColorStop(0, rgba(color, 0))
    glow.addColorStop(0.28, rgba(color, palette.dark ? 0.055 : 0.045))
    glow.addColorStop(0.62, rgba(color, palette.dark ? 0.22 + opening * 0.4 : 0.17 + opening * 0.18))
    glow.addColorStop(1, rgba(palette.tertiary, 0))
    ctx.strokeStyle = glow
    for (let filament = 0; filament < 42; filament++) {
      ctx.beginPath()
      for (let step = 0; step <= 28; step++) {
        const y = height * (step / 28 - 0.1)
        const fold = Math.sin(step * 0.13 + drift + curtain) * width * (0.025 + opening * 0.09)
        const ribbon = Math.cos(filament * 0.1 + step * 0.08 + drift) * width * 0.025
        const x = base + fold + ribbon + (filament - 21) * width * 0.0026 + (motion.x - 0.5) * width * 0.09
        if (step === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineWidth = 1.3 + Math.sin((filament / 42) * Math.PI) * 2
      ctx.stroke()
    }
  }
  for (let star = 0; star < 56; star++) {
    const x = (star * 167.31) % width
    const y = (star * star * 43.7) % height
    ctx.fillStyle = rgba(palette.tertiary, 0.12 + (1 + Math.sin(drift + star)) * 0.13)
    ctx.fillRect(x, y, star % 9 === 0 ? 2 : 1, 1)
  }
}

export const drawTidal: DrawScene = (ctx, motion, width, height, time, palette) => {
  const tide = motion.sceneProgress
  const phase = time * 0.00024
  const cx = width * 0.82 + (motion.x - 0.5) * width * 0.1
  const cy = height * 0.3 + (motion.y - 0.5) * height * 0.08
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.62)
  glow.addColorStop(0, rgba(palette.secondary, 0.13 + tide * 0.28))
  glow.addColorStop(0.3, rgba(palette.accent, 0.05))
  glow.addColorStop(1, rgba(palette.accent, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)
  for (let wave = 0; wave < 38; wave++) {
    const radius = (wave + 1) * width * (0.018 + tide * 0.022)
    ctx.beginPath()
    for (let point = 0; point <= 96; point++) {
      const a = (point / 96) * Math.PI * 2
      const ripple =
        (Math.sin(a * 4 + phase + wave * 0.24) * width * 0.017 +
          Math.cos(a * 7 - phase * 0.6 + wave * 0.1) * width * 0.006) *
        Math.min(1, (wave + 1) / 4) * (0.35 + tide * 1.1)
      const x = cx + Math.cos(a) * (radius + ripple)
      const y = cy + Math.sin(a) * (radius * 0.57 + ripple) + Math.sin(a + phase) * radius * 0.13
      if (point === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.strokeStyle = rgba(wave % 5 ? palette.accent : palette.tertiary, (wave % 5 ? 0.2 : 0.58) * (1 - wave / 50))
    ctx.lineWidth = wave % 5 ? 1 : 2.8
    ctx.stroke()
  }
}
