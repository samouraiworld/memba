import './home.css'

export type ActionAccent = 'teal' | 'amber' | 'danger' | 'neutral'

export interface ActionCardProps {
  accent?: ActionAccent
  icon?: string
  eyebrow?: string
  title: string
  meta?: string
  actionLabel?: string
  href?: string
  onAction?: () => void
  loading?: boolean
}

export function ActionCard({
  accent = 'neutral',
  icon,
  eyebrow,
  title,
  meta,
  actionLabel,
  href,
  onAction,
  loading,
}: ActionCardProps) {
  if (loading) {
    return <div className="action-card action-card--skeleton" data-testid="action-card-skeleton" />
  }

  const inner = (
    <>
      <div className={`action-card__rail action-card__rail--${accent}`} />
      <div className="action-card__body">
        {eyebrow && <span className="action-card__eyebrow">{eyebrow}</span>}
        <span className="action-card__title">
          {icon && <i className={`ti ti-${icon} action-card__icon`} aria-hidden="true" />}
          {title}
        </span>
        {meta && <span className="action-card__meta">{meta}</span>}
      </div>
      {actionLabel && <span className="action-card__action-label">{actionLabel}</span>}
    </>
  )

  const className = `action-card action-card--${accent}`

  if (href) {
    return (
      <a href={href} className={className} aria-label={actionLabel ?? title}>
        {inner}
      </a>
    )
  }

  if (onAction) {
    return (
      <button type="button" onClick={onAction} className={className} aria-label={actionLabel ?? title}>
        {inner}
      </button>
    )
  }

  return (
    <div className={className}>
      {inner}
    </div>
  )
}
