import mark from '../assets/ops-mark.svg?raw'
import { useEffect, useRef } from 'react'

export function BrandMark() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const update = () => ref.current?.setAttribute('data-paused', String(document.hidden))
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return <span ref={ref} className="brand-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: mark }} />
}
