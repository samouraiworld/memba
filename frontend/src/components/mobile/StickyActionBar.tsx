import type { ReactNode } from 'react'

interface StickyActionBarProps {
    children: ReactNode
    /** Accessible label for the action group (e.g. "Proposal actions"). */
    ariaLabel?: string
}

/**
 * Thumb-zone action bar pinned to the bottom of a mobile view. Honors the
 * bottom safe-area inset (see mobile-primitives.css). Intended for the
 * primary action(s) of write/flow screens inside the mobile shell.
 */
export function StickyActionBar({ children, ariaLabel }: StickyActionBarProps) {
    return (
        <div
            className="mb-action-bar"
            data-testid="sticky-action-bar"
            role="group"
            aria-label={ariaLabel}
        >
            {children}
        </div>
    )
}
