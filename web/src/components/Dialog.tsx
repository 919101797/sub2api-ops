import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, TriangleAlert } from 'lucide-react'
import { Button } from './ui'

const modalStack: HTMLElement[] = []
const focusable =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

export function Dialog({
  title,
  onClose,
  children,
  kind = 'modal',
  className = '',
  busy = false,
}: {
  children: ReactNode | ((dismiss: () => void) => ReactNode)
  title: string
  onClose: () => void
  kind?: 'modal' | 'drawer' | 'wide'
  className?: string
  busy?: boolean
}) {
  const titleId = useId()
  const layer = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const callback = useRef(onClose)
  const pending = useRef(busy)
  callback.current = onClose
  pending.current = busy
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const close = useCallback(() => {
    if (pending.current || timer.current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      callback.current()
      return
    }
    setClosing(true)
    timer.current = setTimeout(() => callback.current(), 180)
  }, [])
  useEffect(() => {
    const currentLayer = layer.current!
    const trigger = document.activeElement as HTMLElement | null
    const previousLayer = modalStack.at(-1)
    const root = document.getElementById('root')
    const previousOverflow = document.body.style.overflow
    if (previousLayer) previousLayer.inert = true
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    modalStack.push(currentLayer)
    const initialFocus = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current
    initialFocus?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== currentLayer) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
      if (event.key !== 'Tab') return
      const controls = [...panel.current!.querySelectorAll<HTMLElement>(focusable)].filter(
        (element) => !element.closest('[hidden], [inert]'),
      )
      const first = controls[0],
        last = controls.at(-1)
      if (!first) {
        event.preventDefault()
        panel.current?.focus()
        return
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      if (timer.current) clearTimeout(timer.current)
      modalStack.splice(modalStack.indexOf(currentLayer), 1)
      if (previousLayer) previousLayer.inert = false
      if (root && modalStack.length === 0) root.inert = false
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [close])
  return createPortal(
    <div
      ref={layer}
      className={`dialog-layer dialog-layer--${kind}${closing ? ' is-closing' : ''}`}
      data-modal-layer=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={panel}
        className={`dialog-panel ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <Button variant="quiet" disabled={busy} aria-label={`关闭${title}`} onClick={close}>
            <X size={19} aria-hidden="true" />
          </Button>
        </header>
        {typeof children === 'function' ? children(close) : children}
      </section>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmation,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  confirmLabel: string
  confirmation?: string
  busy?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <Dialog title={title} onClose={onClose} busy={Boolean(busy)}>
      {(dismiss) => (
        <>
          <div className="confirmation-body">
            <span className="confirmation-icon">
              <TriangleAlert size={23} aria-hidden="true" />
            </span>
            <p>{message}</p>
            {confirmation && (
              <label className="field">
                <span>输入“{confirmation}”以确认</span>
                <input
                  aria-label="确认文本"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="dialog-actions">
            <Button variant="secondary" data-autofocus disabled={busy} onClick={dismiss}>
              取消
            </Button>
            <Button
              variant="danger"
              busy={Boolean(busy)}
              disabled={confirmation !== undefined && value !== confirmation}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </footer>
        </>
      )}
    </Dialog>
  )
}
