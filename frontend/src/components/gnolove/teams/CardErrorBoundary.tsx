/**
 * CardErrorBoundary — wrap one team-hub card so its crash doesn't blank the page.
 *
 * Different from SectionErrorBoundary (which guards the whole gnolove section):
 * this is fine-grained — six failing data sources on the team hub should not
 * become a six-banner wall. Each card renders its own polite "couldn't load"
 * fallback instead.
 *
 * @module components/gnolove/teams/CardErrorBoundary
 */

import { Component, type ReactNode } from "react"

interface Props {
    name: string
    children: ReactNode
    /** Optional override for the failure UI. Defaults to a compact banner. */
    fallback?: (error: Error, name: string) => ReactNode
}

interface State {
    error: Error | null
}

export class CardErrorBoundary extends Component<Props, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: { componentStack?: string }) {
        // Logs only — no automatic reporting hook here, the global section
        // boundary handles Sentry. Per-card crashes are usually benign API
        // shape mismatches that the user-visible card already calls out.
        console.error(`[TeamHub:${this.props.name}]`, error, info.componentStack)
    }

    render() {
        if (this.state.error) {
            if (this.props.fallback) return this.props.fallback(this.state.error, this.props.name)
            return (
                <div className="gl-thub-card gl-thub-card-error" role="alert">
                    <h3 className="gl-thub-card-title">{this.props.name}</h3>
                    <p className="gl-thub-card-error-msg">
                        Couldn’t load this card. The rest of the page should still work.
                    </p>
                </div>
            )
        }
        return this.props.children
    }
}
