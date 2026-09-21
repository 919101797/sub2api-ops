import { describe, expect, it } from 'vitest'
import { eclipseDarkness } from './eclipseLighting'
import { createSceneLighting } from './sceneLighting'

describe('日蚀环境光', () => {
  it('场景-008-24：由日照到全食连续变暗', () => {
    expect(eclipseDarkness(0.46)).toBe(0)
    expect(eclipseDarkness(0.999)).toBe(100)
    const stages = [0.55, 0.65, 0.75, 0.85, 0.95].map(eclipseDarkness)
    expect(stages).toEqual([...stages].sort((a, b) => a - b))
    expect(stages[0]).toBeGreaterThan(0)
    expect(stages.at(-1)).toBeLessThan(100)
  })
  it('场景-008-25：限速与去重，释放时清除环境光', () => {
    const root = document.createElement('div')
    const lighting = createSceneLighting(root, '--eclipse-darkness')
    lighting.update(0, 0)
    expect(root.style.getPropertyValue('--eclipse-darkness')).toBe('0%')
    lighting.update(1, 10)
    expect(root.style.getPropertyValue('--eclipse-darkness')).toBe('0%')
    lighting.update(1, 50)
    expect(root.style.getPropertyValue('--eclipse-darkness')).toBe('100%')
    lighting.update(0, 100)
    expect(root.style.getPropertyValue('--eclipse-darkness')).toBe('0%')
    lighting.dispose()
    expect(root.style.getPropertyValue('--eclipse-darkness')).toBe('')
  })
})
