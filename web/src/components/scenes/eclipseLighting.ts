/** A single exposure curve drives both the celestial scene and the interface. */
export function eclipseDarkness(eclipse: number): number {
  const progress = Math.min(1, Math.max(0, (eclipse - 0.46) / 0.539))
  return Math.round(progress * progress * (3 - 2 * progress) * 100)
}
