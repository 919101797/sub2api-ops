/** Bound backing-store memory while preserving native detail on common displays. */
export function cosmicCanvasResolution(width: number, height: number, devicePixelRatio: number) {
  const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4_200_000 / Math.max(width * height, 1)))
  return { ratio, width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) }
}
