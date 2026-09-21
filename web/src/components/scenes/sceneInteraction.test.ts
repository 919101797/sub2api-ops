import { afterEach, expect, it, vi } from 'vitest'
import { createSceneInteraction, SCENE_TOGGLE_EVENT } from './sceneInteraction'

afterEach(() => vi.restoreAllMocks())

it.each(['moon', 'galaxy', 'nebula', 'quantum', 'aurora', 'tidal', 'ferrofluid', 'lighttunnel'] as const)(
  '场景-008-26：%s 静置不推进，靠近跟随，停住休眠，离开连续退回', (style) => {
    const control = createSceneInteraction(style, false)
    const host = document.createElement('div')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1600, height: 1000 } as DOMRect)
    const disconnect = control.connect(host)
    expect(control.sample(100_000).progress).toBe(0)
    let time = 100_000
    const advance = () => { for (let i = 0; i < 400; i++) control.sample(time += 40) }
    const center = control.center(1600)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: center.x * 1600, clientY: center.y * 1000 }))
    advance()
    expect(control.sample(time).progress).toBe(1)
    expect(control.settled()).toBe(true)
    const lighting = document.documentElement.style.getPropertyValue('--scene-engagement')
    window.dispatchEvent(new Event('blur'))
    const firstReturn = control.sample(time += 40).progress
    expect(firstReturn).toBeGreaterThan(0.8)
    expect(firstReturn).toBeLessThan(1)
    advance()
    expect(control.sample(time).progress).toBe(0)
    expect(control.settled()).toBe(true)
    expect(lighting).toBe('100%')
    expect(host.getBoundingClientRect).toHaveBeenCalledOnce()
    disconnect()
    expect(document.documentElement.style.getPropertyValue('--scene-engagement')).toBe('')
  },
)

it('场景-008-27/31/32：控件不激活场景，键盘可保持和收回，触摸取消后退回', () => {
  const control = createSceneInteraction('galaxy', false)
  const host = document.createElement('div')
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1600, height: 1000 } as DOMRect)
  const disconnect = control.connect(host)
  let time = 0
  const advance = () => { for (let i = 0; i < 400; i++) control.sample(time += 40) }
  const button = document.createElement('button')
  document.body.append(button)
  button.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 1184, clientY: 340 }))
  advance()
  expect(control.sample(time).progress).toBe(0)
  window.dispatchEvent(new CustomEvent(SCENE_TOGGLE_EVENT))
  advance()
  expect(control.sample(time).progress).toBe(1)
  window.dispatchEvent(new CustomEvent(SCENE_TOGGLE_EVENT))
  advance()
  expect(control.sample(time).progress).toBe(0)
  const down = new MouseEvent('pointerdown', { clientX: 1184, clientY: 340 })
  Object.defineProperty(down, 'pointerType', { value: 'touch' })
  window.dispatchEvent(down)
  advance()
  expect(control.sample(time).progress).toBe(1)
  window.dispatchEvent(new Event('pointercancel'))
  advance()
  expect(control.sample(time).progress).toBe(0)
  button.remove()
  disconnect()
})

it('场景-008-28：减弱动态效果不响应场景操作', () => {
  const control = createSceneInteraction('moon', true)
  const disconnect = control.connect(document.createElement('div'))
  const initial = control.sample(0)
  window.dispatchEvent(new CustomEvent(SCENE_TOGGLE_EVENT))
  expect(control.sample(10_000)).toEqual(initial)
  expect(control.settled()).toBe(true)
  disconnect()
})
