import React from "react"
import { Link } from "react-router-dom"
import "./home.css"

export type DoorState = "ready" | "loading" | "empty" | "error"
export type DoorVariant =
  | "featured"
  | "list"
  | "stat"
  | "search"
  | "promo"
  | "action"
  | "invitation"

export interface DoorProps {
  variant: DoorVariant
  state?: DoorState // default "ready"
  eyebrow: string // lowercase mono label
  icon?: React.ReactNode // optional leading icon (phosphor)
  href?: string // makes the door navigable
  onClick?: () => void
  onRetry?: () => void // used by state="error"
  invitation?: { label: string; href: string } // used when state="empty"
  children?: React.ReactNode // body for state="ready"
}

function DoorBody({ state, children, invitation, onRetry }: Pick<DoorProps, "state" | "children" | "invitation" | "onRetry">) {
  const resolved = state ?? "ready"

  if (resolved === "loading") {
    return (
      <div className="door__body">
        <div className="door__sk" />
        <div className="door__sk door__sk--mid" />
        <div className="door__sk door__sk--short" />
      </div>
    )
  }

  if (resolved === "empty") {
    if (invitation) {
      return (
        <div className="door__body door__body--empty">
          <Link to={invitation.href} className="door__invitation-link">
            {invitation.label}
          </Link>
        </div>
      )
    }
    return (
      <div className="door__body door__body--empty">
        <span className="door__empty-msg">nothing here yet</span>
      </div>
    )
  }

  if (resolved === "error") {
    return (
      <div className="door__body door__body--error">
        <span className="door__error-msg">couldn&apos;t load</span>
        {onRetry && (
          <button type="button" className="door__retry" onClick={onRetry}>
            retry
          </button>
        )}
      </div>
    )
  }

  // ready
  return <div className="door__body">{children}</div>
}

export function Door({
  variant,
  state = "ready",
  eyebrow,
  icon,
  href,
  onClick,
  onRetry,
  invitation,
  children,
}: DoorProps) {
  const className = `door door--${variant}`

  const inner = (
    <>
      <span className="door__eyebrow">
        {icon && <span className="door__icon" aria-hidden="true">{icon}</span>}
        {eyebrow}
      </span>
      <DoorBody state={state} invitation={invitation} onRetry={onRetry}>
        {children}
      </DoorBody>
    </>
  )

  if (href?.startsWith("/")) {
    return (
      <Link to={href} className={className}>
        {inner}
      </Link>
    )
  }

  if (href?.startsWith("http")) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    )
  }

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {inner}
      </button>
    )
  }

  return <div className={className}>{inner}</div>
}
