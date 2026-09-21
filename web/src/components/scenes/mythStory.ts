import { hash } from './cosmicTextures'

export type MythStyle = 'galaxy' | 'nebula'
export type StoryPoint = { x: number; y: number }
export const storyEase = (a: number, b: number, p: number) => {
  const t = Math.max(0, Math.min(1, (p - a) / (b - a)))
  return t * t * t * (10 + t * (-15 + t * 6))
}
const pulse = (a: number, b: number, c: number, p: number) => storyEase(a, b, p) * (1 - storyEase(b, c, p))
const mix = (a: StoryPoint, b: StoryPoint, p: number): StoryPoint => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p })

export function creationStory(p: number) {
  const gather = storyEase(0.02, 0.3, p), bloom = storyEase(0.28, 0.76, p)
  const galaxy = storyEase(0.62, 1, p)
  return {
    gather, bloom, galaxy,
    figure: pulse(0.19, 0.34, 0.54, p) * 0.12,
    radiance: pulse(0.2, 0.5, 0.86, p),
    light: 0.18 + pulse(0.26, 0.55, 0.9, p) * 0.24 + galaxy * 0.12,
    warmth: 0.07 + pulse(0.26, 0.5, 0.86, p) * 0.12,
  }
}

export function mendingStory(p: number) {
  const forge = pulse(0.16, 0.38, 0.67, p), restored = storyEase(0.72, 0.98, p)
  return {
    forge, restored,
    collect: storyEase(0.13, 0.38, p),
    weave: storyEase(0.44, 0.92, p),
    figure: storyEase(0.12, 0.28, p) * (1 - storyEase(0.75, 0.94, p)),
    light: 0.13 + forge * 0.37 + storyEase(0.52, 0.94, p) * 0.36,
    warmth: 0.08 + forge * 0.66,
  }
}

export function mythFrame(style: MythStyle, p: number, w: number, h: number) {
  const narrow = w < 820
  return {
    x: w * (narrow ? 0.65 : 0.74),
    y: h * (narrow ? 0.23 : style === 'galaxy' ? (w < 1150 ? 0.26 : 0.34) : 0.3),
    radius: Math.min(w * (narrow ? 0.51 : 0.34), h * (style === 'galaxy' ? 0.39 : 0.44)),
    scale: style === 'galaxy' ? 1 + 0.12 * storyEase(0.3, 0.92, p) : 1 + 0.16 * storyEase(0.28, 0.82, p),
    angle: style === 'galaxy' ? -0.08 + 0.16 * storyEase(0.3, 0.94, p) : -0.12 + 0.1 * storyEase(0.2, 0.85, p),
  }
}

// Every star follows the same uninterrupted gathering, unfurling and river path.
export function creationDust(id: number, p: number) {
  const seed = hash(id, 67), angle = hash(id, 123) * Math.PI * 2
  const { gather, bloom, galaxy } = creationStory(p)
  const radius = (0.16 + Math.sqrt(seed) * 0.72) * (1 - gather * 0.65) + bloom * (0.16 + seed * 0.62)
  const turn = angle + gather * (0.35 + seed * 0.5) + bloom * 0.32
  const emerging = { x: Math.cos(turn) * radius, y: Math.sin(turn) * radius * 0.65 }
  const t = hash(id, 97)
  const destination = {
    x: (t - 0.7) * 3.6 + (hash(id, 79) - 0.5) * 0.25,
    y: 0.2 - t * 0.5 + Math.sin(t * Math.PI * 2) * 0.2 + (hash(id, 33) - 0.5) * 0.25,
  }
  return { ...mix(emerging, destination, galaxy), glow: hash(id, 41) }
}

export function mendingSeam(t: number): StoryPoint {
  return { x: (t - 0.5) * 2.5, y: -0.35 + 0.19 * Math.sin(t * Math.PI * 2) + 0.24 * t }
}
export const MENDING_PALM = { x: -0.24, y: -0.18 }
export function stonePoint(id: number): StoryPoint {
  const angle = (id % 5) * Math.PI * 2 / 5 - Math.PI / 2
  return { x: MENDING_PALM.x + Math.cos(angle) * 0.095, y: MENDING_PALM.y - 0.08 + Math.sin(angle) * 0.07 }
}
export function repairAt(t: number, p: number) {
  return storyEase(0.62 + t * 0.22, 0.7 + t * 0.22, p)
}
export function mendingDestination(id: number): StoryPoint {
  const t = (id + 0.5) / 48, seam = mendingSeam(t)
  return { x: seam.x, y: seam.y + (hash(id, 192) - 0.5) * 0.1 }
}
export function mendingThread(id: number, t: number): StoryPoint {
  const a = stonePoint(id), d = mendingDestination(id), k = 1 - t
  const b = { x: a.x - 0.25 + hash(id, 43) * 0.4, y: a.y - 0.32 }
  const c = { x: d.x + 0.18 * Math.sin(id), y: d.y - 0.26 }
  return { x: k ** 3 * a.x + 3 * k * k * t * b.x + 3 * k * t * t * c.x + t ** 3 * d.x,
    y: k ** 3 * a.y + 3 * k * k * t * b.y + 3 * k * t * t * c.y + t ** 3 * d.y }
}
export function mendingStar(id: number, p: number) {
  const t = (id + 0.5) / 48, seed = hash(id, 77), origin = mendingDestination(id)
  const fallen = { x: origin.x + 0.12 * Math.sin(id), y: origin.y + 0.28 + seed * 0.35 }
  const falling = mix(origin, fallen, storyEase(0, 0.18 + seed * 0.04, p))
  const collect = storyEase(0.14 + seed * 0.04, 0.34 + seed * 0.02, p)
  const gathered = mix(falling, stonePoint(id), collect)
  const arrived = storyEase(0.44 + t * 0.2, 0.62 + t * 0.22, p)
  const threaded = mendingThread(id, arrived)
  const point = mix(gathered, threaded, collect)
  const release = storyEase(0.8, 1, p) * arrived
  return { x: point.x + (hash(id, 81) - 0.5) * 0.25 * release,
    y: point.y + (hash(id, 98) - 0.5) * 0.48 * release, arrived }
}
