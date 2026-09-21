import { creationStory, mendingStory } from './mythStory'
import { moonStory } from './moonStory'
export type CosmicStyle = 'moon' | 'galaxy' | 'nebula'
export const isCosmicStyle = (style: string): style is CosmicStyle =>
  style === 'moon' || style === 'galaxy' || style === 'nebula'

export const smooth = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

export function cosmicAtmosphere(style: CosmicStyle, p: number) {
  if (style === 'moon') {
    const { light, warmth } = moonStory(p)
    return { light, warmth }
  }
  const { light, warmth } = style === 'galaxy' ? creationStory(p) : mendingStory(p)
  return { light, warmth }
}
