import moonUrl from '../../assets/moon-lro.webp'
import earthUrl from '../../assets/earth-blue-marble.webp'
import nebulaUrl from '../../assets/nebula-material.webp'
import groundUrl from '../../assets/lunar-ground.webp'
import changeUrl from '../../assets/moon-story/change.png'
import palaceUrl from '../../assets/moon-story/moon-palace.png'
import rocketUrl from '../../assets/moon-story/crew-rocket.png'
import cloudUrl from '../../assets/moon-story/era-clouds.png'
import panguUrl from '../../assets/myth-stories/pangu.png'
import nuwaUrl from '../../assets/myth-stories/nuwa.png'
import veilUrl from '../../assets/myth-stories/star-veil.png'
import type { CosmicStyle } from './cosmicMotion'

export function hash(x: number, y: number, seed = 0) {
  let n = Math.imul(x + seed * 71, 374761393) ^ Math.imul(y + seed * 137, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}
export function blend(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((v, i) => v + (b[i]! - v) * t) as [number, number, number]
}
const images = new Map<string, HTMLImageElement>()
function texture(url: string) {
  let image = images.get(url)
  if (!image) {
    image = new Image()
    image.src = url
    images.set(url, image)
  }
  return image
}
export const getMoonTexture = () => texture(moonUrl)
export const getEarthTexture = () => texture(earthUrl)
export const getNebulaTexture = () => texture(nebulaUrl)
export const getGroundTexture = () => texture(groundUrl)
export const getChangeTexture = () => texture(changeUrl)
export const getPalaceTexture = () => texture(palaceUrl)
export const getRocketTexture = () => texture(rocketUrl)
export const getMoonCloudTexture = () => texture(cloudUrl)
export const getPanguTexture = () => texture(panguUrl)
export const getNuwaTexture = () => texture(nuwaUrl)
export const getStarVeilTexture = () => texture(veilUrl)
export const prepareCosmicTextures = (style: CosmicStyle) =>
  Promise.all(
    (style === 'moon'
      ? [getMoonTexture(), getEarthTexture(), getGroundTexture(), getChangeTexture(), getPalaceTexture(), getRocketTexture(), getMoonCloudTexture()]
      : style === 'galaxy' ? [getPanguTexture(), getStarVeilTexture()] : [getNebulaTexture(), getNuwaTexture(), getMoonCloudTexture()]).map((image) =>
      image.decode(),
    ),
  )
