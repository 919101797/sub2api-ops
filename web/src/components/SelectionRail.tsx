import { createContext, useContext, useId, type ReactNode } from 'react'
import { LayoutGroup, motion, type HTMLMotionProps } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'

const RailVariant = createContext<'pill' | 'line'>('pill')

export function SelectionRail({
  children,
  className = '',
  variant = 'pill',
  as = 'div',
  ...props
}: HTMLMotionProps<'div'> & { children: ReactNode; variant?: 'pill' | 'line'; as?: 'div' | 'nav' }) {
  const id = useId()
  const Root = as === 'nav' ? motion.nav : motion.div
  return (
    <LayoutGroup id={id}>
      <RailVariant.Provider value={variant}>
        <Root
          layoutScroll
          className={`selection-rail selection-rail--${variant} ${className}`}
          data-no-swipe
          {...props}
        >
          {children}
        </Root>
      </RailVariant.Provider>
    </LayoutGroup>
  )
}

export function SelectionIndicator({ active }: { active: boolean }) {
  const variant = useContext(RailVariant)
  const reducedMotion = useReducedMotion()
  if (!active) return null
  return (
    <motion.span
      aria-hidden="true"
      className={`selection-indicator selection-indicator--${variant}`}
      {...(reducedMotion ? {} : { layoutId: 'selection' })}
      initial={false}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 430, damping: 29, mass: 0.8 }}
      style={{ borderRadius: variant === 'pill' ? 18 : 2 }}
    />
  )
}
