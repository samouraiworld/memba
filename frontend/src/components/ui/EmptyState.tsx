/**
 * EmptyState — a shared empty-surface treatment: optional icon, a title, a one-line
 * body, and an optional CTA. Replaces the marketplace's one-line muted-text empties
 * (e.g. "No collections yet") so an empty surface invites action instead of looking dead.
 *
 * @module components/ui/EmptyState
 */

import "./EmptyState.css"

export interface EmptyStateAction {
    label: string
    onClick: () => void
}

export function EmptyState({
    icon,
    title,
    body,
    action,
    className,
}: {
    /** Tabler icon class name (e.g. "ti-photo"), rendered if provided. */
    icon?: string
    title: string
    body: string
    action?: EmptyStateAction
    className?: string
}) {
    return (
        <div className={"emptystate" + (className ? " " + className : "")}>
            {icon && <i className={"ti " + icon + " emptystate__icon"} aria-hidden="true" />}
            <p className="emptystate__title">{title}</p>
            <p className="emptystate__body">{body}</p>
            {action && (
                <button type="button" className="emptystate__cta" onClick={action.onClick}>
                    {action.label}
                </button>
            )}
        </div>
    )
}
