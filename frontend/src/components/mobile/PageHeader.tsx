import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CaretLeft } from '@phosphor-icons/react'

interface PageHeaderProps {
    /** Page title shown in the mobile header bar. */
    title: string
    /**
     * Logical parent path to navigate back to. Hierarchical by design — it
     * always points "up" the route tree, NOT `history(-1)`, so a deep-linked
     * visitor still lands on the parent rather than an arbitrary prior page.
     */
    back?: string
    /** Optional trailing action (e.g. an icon button) rendered at the end. */
    action?: ReactNode
}

/**
 * Mobile page header: back-to-parent control + title + optional action.
 * Styling is mobile-scoped (see mobile-primitives.css); intended for use
 * inside the mobile shell only.
 */
export function PageHeader({ title, back, action }: PageHeaderProps) {
    return (
        <header className="mb-page-header" data-testid="page-header">
            {back ? (
                <Link
                    to={back}
                    className="mb-page-header__back"
                    aria-label="Back"
                    data-testid="page-header-back"
                >
                    <CaretLeft size={20} weight="bold" />
                </Link>
            ) : (
                <span className="mb-page-header__spacer" aria-hidden="true" />
            )}
            <h1 className="mb-page-header__title">{title}</h1>
            <div className="mb-page-header__action">{action}</div>
        </header>
    )
}
