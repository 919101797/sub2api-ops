import { useEffect, useState, type PropsWithChildren } from 'react'

export function Disclosure({ open, id, children }: PropsWithChildren<{ open: boolean; id: string }>) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) setMounted(true)
  }, [open])
  return (
    <div
      id={id}
      className="disclosure"
      data-open={open}
      inert={!open}
      aria-hidden={!open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !open) setMounted(false)
      }}
    >
      <div>{mounted && children}</div>
    </div>
  )
}
