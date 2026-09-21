import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

export function Button({
  children,
  variant = 'primary',
  busy = false,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  busy?: boolean
}) {
  return (
    <button
      className={`button button--${variant} ${className}`}
      type={type}
      {...props}
      aria-busy={busy || undefined}
      disabled={busy || props.disabled}
    >
      {busy && <LoaderCircle size={15} className="spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function StatusPill({
  tone,
  children,
}: PropsWithChildren<{ tone: 'healthy' | 'warning' | 'danger' | 'neutral' }>) {
  return (
    <span className={`status status--${tone}`}>
      <span className="status__dot" aria-hidden="true" />
      {children}
    </span>
  )
}

export function PageHeading({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="page-heading">
      <h1>{title}</h1>
      {actions && <div className="page-heading__actions">{actions}</div>}
    </header>
  )
}

export function LoadingScreen() {
  return (
    <div className="loading-screen" role="status">
      <LoaderCircle size={22} strokeWidth={2.25} className="spin" aria-hidden="true" />
      <span>正在读取运维状态</span>
    </div>
  )
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-panel" role="alert">
      <div>
        <strong>无法读取数据</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  )
}
