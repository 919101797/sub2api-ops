/** Quantized, rate-limited writes keep scene exposure off React's render path. */
export function createSceneLighting(root: HTMLElement, property: '--eclipse-darkness' | '--cosmic-light' | '--cosmic-warmth' | '--cosmic-travel' | '--scene-engagement') {
  let previous = -1
  let lastWrite = -Infinity
  return {
    update(exposure: number, time: number) {
      const value = Math.round(Math.max(0, Math.min(1, exposure)) * 100)
      if (value === previous || time - lastWrite < 1000 / 24) return
      root.style.setProperty(property, `${value}%`)
      previous = value
      lastWrite = time
    },
    dispose() {
      root.style.removeProperty(property)
    },
  }
}
