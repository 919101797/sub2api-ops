import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

if (typeof window !== 'undefined') {
  // DOM tests verify settled business state; real spring motion is checked in the browser.
  const { MotionGlobalConfig } = await import('motion/react')
  MotionGlobalConfig.skipAnimations = true
  window.scrollTo = vi.fn()
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
}
