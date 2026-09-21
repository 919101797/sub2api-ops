import { moonEase } from './moonStory'

// Cubic Hermite interpolation shares tangents at each camera key, so there is no stop or kink at a cut.
function track(p: number, keys: readonly (readonly [number, number])[]) {
  let i = 0
  while (i < keys.length - 2 && p > keys[i + 1]![0]) i++
  const a = keys[i]!, b = keys[i + 1]!
  const before = keys[Math.max(0, i - 1)]!, after = keys[Math.min(keys.length - 1, i + 2)]!
  const span = b[0] - a[0], t = Math.max(0, Math.min(1, (p - a[0]) / span))
  const m0 = i === 0 ? 0 : (b[1] - before[1]) / (b[0] - before[0])
  const m1 = i === keys.length - 2 ? 0 : (after[1] - a[1]) / (after[0] - a[0])
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a[1] + (t ** 3 - 2 * t ** 2 + t) * span * m0
    + (-2 * t ** 3 + 3 * t ** 2) * b[1] + (t ** 3 - t ** 2) * span * m1
}

export function moonFrame(progress: number, w: number, h: number) {
  const p = Math.max(0, Math.min(1, progress)), narrow = w < 820
  const approach = moonEase(0.67, 0.97, p)
  const baseRadius = Math.min(w * (narrow ? 0.23 : 0.16), h * 0.2)
  const radius = baseRadius * Math.exp(Math.log(w * 6 / baseRadius) * approach)
  const initialTop = h * 0.22 - baseRadius
  const top = initialTop + (h * 0.36 - initialTop) * moonEase(0.67, 0.8, p) + h * 0.08 * moonEase(0.8, 0.98, p)
  const turnHome = moonEase(0.79, 0.97, p)
  return {
    traveler: {
      x: w * track(p, [[0, 0.81], [0.24, 0.79], [0.36, 0.79], [0.56, 0.8], [0.72, 0.77], [0.9, 0.65], [1, 0.62]]),
      y: h * (narrow
        ? track(p, [[0, 0.13], [0.24, 0.12], [0.36, 0.15], [0.56, 0.16], [0.72, 0.22], [0.9, 0.34], [1, 0.38]])
        : track(p, [[0, 0.2], [0.24, 0.16], [0.36, 0.2], [0.56, 0.21], [0.72, 0.25], [0.9, 0.34], [1, 0.38]])),
    },
    vehicleLength: Math.min(h * 0.56, w * (narrow ? 0.95 : 0.6)) * track(p, [[0, 1], [0.36, 1], [0.6, 0.95], [0.74, 0.76], [0.9, 0.64], [1, 0.5]]),
    angle: track(p, [[0, 0], [0.36, 0], [0.56, 0.05], [0.72, -0.16], [0.9, -0.36], [1, -0.36]]),
    moon: { x: w * (0.78 - approach * 0.28), y: top + radius, radius },
    earth: {
      x: w * (0.93 - turnHome * 0.14),
      y: h * (0.68 - turnHome * 0.46),
      radius: Math.min(w * 0.065, h * 0.07) * (1 - turnHome * 0.22),
      opacity: moonEase(0.55, 0.67, p),
    },
  }
}
export function lunarHorizon(moon: { x: number, y: number, radius: number }, x: number) {
  const distance = x - moon.x
  return Math.abs(distance) < moon.radius ? moon.y - Math.sqrt(moon.radius ** 2 - distance ** 2) : Infinity
}
export type MoonFrame = ReturnType<typeof moonFrame>
