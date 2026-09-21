import { eclipseDarkness } from './eclipseLighting'
import { rgba, type MotionState, type Palette } from './types'

export function drawOrbital(
  context: CanvasRenderingContext2D,
  motion: MotionState,
  width: number,
  height: number,
  time: number,
  palette: Palette,
) {
  const radius = Math.min(width * 0.25, height * 0.29)
  const centerX = width * 0.77 + (motion.x - 0.58) * radius * 0.12
  const centerY = height * 0.31 + (motion.y - 0.5) * radius * 0.09
  const eclipse = Math.min(1, Math.max(0, motion.eclipse))
  const easedEclipse = eclipse * eclipse * (3 - 2 * eclipse)
  const darkness = eclipseDarkness(eclipse) / 100
  const lightLevel = 1 - darkness * 0.88
  const coronaRadius = radius * (1.48 + lightLevel * 0.08)

  const ambient = context.createRadialGradient(centerX, centerY, radius * 0.12, centerX, centerY, radius * 2.25)
  ambient.addColorStop(0, rgba(palette.tertiary, 0.11 + lightLevel * 0.2))
  ambient.addColorStop(0.38, rgba(palette.accent, 0.055 + lightLevel * 0.09))
  ambient.addColorStop(1, rgba(palette.secondary, 0))
  context.fillStyle = ambient
  context.fillRect(0, 0, width, height)

  const corona = context.createRadialGradient(centerX, centerY, radius * 0.62, centerX, centerY, coronaRadius)
  corona.addColorStop(0, rgba(palette.tertiary, 0))
  corona.addColorStop(0.28, rgba(palette.tertiary, 0.035 + lightLevel * 0.08))
  corona.addColorStop(0.48, rgba(palette.accent, 0.08 + lightLevel * 0.18))
  corona.addColorStop(0.7, rgba(palette.secondary, 0.025 + lightLevel * 0.055))
  corona.addColorStop(1, rgba(palette.secondary, 0))
  context.fillStyle = corona
  context.fillRect(centerX - coronaRadius, centerY - coronaRadius, coronaRadius * 2, coronaRadius * 2)

  context.save()
  context.translate(centerX, centerY)
  const flareRotation = time * 0.00007
  for (let flare = 0; flare < 42; flare += 1) {
    const angle = (flare / 42) * Math.PI * 2 + flareRotation
    const flicker = 0.5 + 0.5 * Math.sin(time * 0.0014 + flare * 2.37)
    const start = radius * (1.01 + flicker * 0.012)
    const length = radius * (0.025 + flicker * 0.07 + lightLevel * 0.025)
    context.beginPath()
    context.moveTo(Math.cos(angle) * start, Math.sin(angle) * start)
    context.lineTo(Math.cos(angle) * (start + length), Math.sin(angle) * (start + length))
    context.strokeStyle = rgba(flare % 3 ? palette.accent : palette.tertiary, (0.09 + flicker * 0.17) * lightLevel)
    context.lineWidth = flare % 5 === 0 ? 2.2 : 0.8
    context.stroke()
  }

  for (let lens = 0; lens < 6; lens += 1) {
    const lensRadius = radius * (1.08 + lens * 0.12)
    const start = flareRotation * (lens % 2 ? -1.22 : 1) + lens * 0.72
    context.beginPath()
    context.ellipse(
      0,
      0,
      lensRadius * (1.08 + lens * 0.012),
      lensRadius,
      -0.17,
      start,
      start + Math.PI * (0.72 + lens * 0.1),
    )
    context.strokeStyle = rgba(
      lens % 2 ? palette.secondary : palette.accent,
      (0.08 + lightLevel * 0.1 + lens * 0.012) * lightLevel,
    )
    context.lineWidth = lens === 0 ? 3.4 : 1.1
    context.stroke()
  }

  const sun = context.createRadialGradient(-radius * 0.22, -radius * 0.26, radius * 0.04, 0, 0, radius)
  sun.addColorStop(0, rgba(palette.tertiary, 0.94))
  sun.addColorStop(0.58, rgba(palette.accent, 0.78 + lightLevel * 0.16))
  sun.addColorStop(0.9, rgba(palette.secondary, 0.68 + lightLevel * 0.2))
  sun.addColorStop(1, rgba(palette.tertiary, 0.9))
  context.beginPath()
  context.arc(0, 0, radius, 0, Math.PI * 2)
  context.fillStyle = sun
  context.shadowColor = rgba(palette.tertiary, 0.28 + lightLevel * 0.34)
  context.shadowBlur = 18 + lightLevel * 18
  context.fill()
  context.shadowBlur = 0

  const shadowOffsetX = radius * (1.52 - easedEclipse * 1.52)
  const shadowOffsetY = radius * (0.19 - easedEclipse * 0.19)
  const shadow = context.createRadialGradient(
    shadowOffsetX - radius * 0.22,
    shadowOffsetY - radius * 0.25,
    radius * 0.04,
    shadowOffsetX,
    shadowOffsetY,
    radius * 0.976,
  )
  shadow.addColorStop(0, palette.dark ? '#0b0e18' : '#b4b9c2')
  shadow.addColorStop(0.62, palette.dark ? '#04060c' : '#9ba4b2')
  shadow.addColorStop(1, palette.dark ? '#000105' : '#858f9f')
  context.beginPath()
  context.arc(shadowOffsetX, shadowOffsetY, radius * 0.976, 0, Math.PI * 2)
  context.fillStyle = shadow
  context.fill()

  if (eclipse > 0.84) {
    const totality = Math.min(1, (eclipse - 0.84) / 0.16)
    context.beginPath()
    context.arc(shadowOffsetX, shadowOffsetY, radius * 1.01, 0, Math.PI * 2)
    context.strokeStyle = rgba(palette.tertiary, 0.82 * totality)
    context.lineWidth = 1.2 + totality * 3.8
    context.stroke()
  }
  context.restore()

  for (let star = 0; star < 72; star += 1) {
    const x = (star * 193.73) % Math.max(width, 1)
    const y = (star * star * 17.31 + star * 61.7) % Math.max(height, 1)
    const distance = Math.hypot(x - centerX, y - centerY)
    if (distance < radius * 1.18) continue
    const alpha = (0.07 + (star % 7) * 0.025) * (0.25 + darkness * 1.1)
    context.fillStyle = rgba(star % 5 === 0 ? palette.tertiary : palette.secondary, alpha)
    context.fillRect(x, y, star % 9 === 0 ? 2.4 : 1.1, star % 9 === 0 ? 2.4 : 1.1)
  }
}
