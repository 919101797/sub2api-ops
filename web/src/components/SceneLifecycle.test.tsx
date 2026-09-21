import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Ferrofluid from './open-source/Ferrofluid'
import LightTunnel from './open-source/LightTunnel'
import { ReactBitsScene } from './ReactBitsScene'
import { createSceneInteraction, SCENE_TOGGLE_EVENT } from './scenes/sceneInteraction'

vi.mock('ogl', () => ({
  Renderer: class {
    dpr = 1
    gl = {
      canvas: document.createElement('canvas'),
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
      clearColor: vi.fn(),
      getExtension: () => ({ loseContext: vi.fn() }),
    }
    setSize(width: number, height: number) {
      this.gl.canvas.width = width
      this.gl.canvas.height = height
    }
    render() {}
  },
  Program: class {
    uniforms: object
    constructor(_gl: unknown, options: { uniforms: object }) {
      this.uniforms = options.uniforms
    }
    remove() {}
  },
  Triangle: class {
    remove() {}
  },
  Mesh: class {
    remove() {}
  },
}))
let hidden = false
let sequence = 0
let frames: Map<number, FrameRequestCallback>
beforeEach(() => {
  hidden = false
  sequence = 0
  frames = new Map()
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }])
      }
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('实时场景生命周期', () => {
  it.each(['ferrofluid', 'lighttunnel'] as const)('场景-008-26/27/31：%s 交互唤醒一条循环、落稳停帧、模式切换保留进度', (style) => {
    const interaction = createSceneInteraction(style, false)
    const host = document.createElement('div')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1600, height: 1000 } as DOMRect)
    const disconnect = interaction.connect(host)
    let time = performance.now()
    const advance = (count = 200) => act(() => {
      for (let i = 0; i < count; i++) {
        time += 40
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach(callback => callback(time))
      }
    })
    const view = render(<ReactBitsScene style={style} theme="dark" interaction={interaction} />)
    expect(frames.size).toBe(0)
    act(() => window.dispatchEvent(new CustomEvent(SCENE_TOGGLE_EVENT)))
    expect(frames.size).toBe(1)
    advance(10)
    const progress = Number(host.dataset.sceneProgress)
    expect(progress).toBeGreaterThan(0)
    expect(progress).toBeLessThan(1)
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    expect(frames.size).toBe(0)
    time += 60_000
    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(frames.size).toBe(1)
    advance(1)
    expect(Number(host.dataset.sceneProgress) - progress).toBeLessThan(0.03)
    advance()
    expect(host.dataset.sceneProgress).toBe('1.000')
    expect(frames.size).toBe(0)
    view.rerender(<ReactBitsScene style={style} theme="light" interaction={interaction} />)
    expect(host.dataset.sceneProgress).toBe('1.000')
    expect(frames.size).toBe(0)
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1)
    act(() => window.dispatchEvent(new CustomEvent(SCENE_TOGGLE_EVENT)))
    advance()
    expect(host.dataset.sceneProgress).toBe('0.000')
    expect(frames.size).toBe(0)
    view.unmount()
    disconnect()
    expect(document.documentElement.style.getPropertyValue('--scene-engagement')).toBe('')
  })
  it.each([
    ['磁流', Ferrofluid],
    ['光隧', LightTunnel],
  ] as const)('场景-008-18：%s 在后台停止，恢复时只有一个动画循环', (_name, Component) => {
    const view = render(<Component maxPixelCount={1_600_000} />)
    expect(frames.size).toBe(1)
    act(() => {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(frames.size).toBe(0)
    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(frames.size).toBe(1)
    view.unmount()
    expect(frames.size).toBe(0)
  })
  it('场景-008-19：动态开启减少动画后保留静态画面，再关闭时恢复绘制', () => {
    let reduced = false
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return reduced
      },
      addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
    }))
    const view = render(<ReactBitsScene style="ferrofluid" theme="dark" />)
    expect(frames.size).toBe(1)
    act(() => {
      reduced = true
      listeners.forEach((callback) => callback())
    })
    expect(frames.size).toBe(0)
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1)
    act(() => {
      reduced = false
      listeners.forEach((callback) => callback())
    })
    expect(frames.size).toBe(1)
  })
})
