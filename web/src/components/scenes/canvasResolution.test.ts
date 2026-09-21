import { expect, it } from 'vitest'
import { cosmicCanvasResolution } from './canvasResolution'
it('场景-008-30：2K 桌面不再使用被放大的低于 CSS 分辨率画布', () => {
  const frame = cosmicCanvasResolution(2560, 1440, 2)
  expect(frame.width).toBeGreaterThanOrEqual(2560)
  expect(frame.height).toBeGreaterThanOrEqual(1440)
  expect(frame.width * frame.height).toBeLessThanOrEqual(4_200_000)
})
it('手机支持 2 倍像素，极大视口仍有明确的内存上限', () => {
  expect(cosmicCanvasResolution(390, 844, 3)).toEqual({ ratio: 2, width: 780, height: 1688 })
  const large = cosmicCanvasResolution(5230, 2814, 2)
  expect(large.width * large.height).toBeLessThanOrEqual(4_200_000)
})
