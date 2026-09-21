/** Quintic joins keep both velocity and acceleration quiet at narrative boundaries. */
export function moonEase(from: number, to: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function moonStory(progress: number) {
  const p = Math.max(0, Math.min(1, progress))
  const clouds = moonEase(0.12, 0.25, p) * (1 - moonEase(0.33, 0.45, p))
  const ignition = moonEase(0.32, 0.41, p)
  const cruise = moonEase(0.67, 0.86, p)
  const surface = moonEase(0.86, 0.98, p)
  const ascent = moonEase(0, 0.25, p)
  return {
    myth: 1 - moonEase(0.26, 0.305, p),
    ascent,
    handoff: moonEase(0.26, 0.33, p),
    clouds,
    cloudPass: moonEase(0.12, 0.45, p),
    rocket: moonEase(0.285, 0.33, p) * (1 - moonEase(0.63, 0.715, p)),
    vehicle: moonEase(0.285, 0.33, p) * (1 - moonEase(0.86, 0.94, p)),
    ignition,
    launch: moonEase(0.37, 0.60, p),
    separation: moonEase(0.495, 0.60, p),
    escape: moonEase(0.545, 0.62, p),
    core: moonEase(0.62, 0.715, p),
    atmosphere: moonEase(0.23, 0.38, p) * (1 - moonEase(0.66, 0.82, p)),
    spacecraft: moonEase(0.63, 0.715, p) * (1 - moonEase(0.86, 0.94, p)),
    cruise,
    descent: moonEase(0.785, 0.975, p),
    surface,
    earthrise: moonEase(0.88, 0.99, p),
    light: 0.25 + 0.1 * ascent * (1 - ignition) + 0.18 * clouds + 0.28 * ignition * (1 - cruise) - 0.17 * cruise + 0.28 * surface,
    warmth: 0.16 + 0.56 * ignition * (1 - cruise) + 0.15 * clouds - 0.12 * surface,
  }
}
