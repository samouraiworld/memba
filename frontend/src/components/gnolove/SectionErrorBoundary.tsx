/**
 * SectionErrorBoundary — scoped boundary for any gnolove card or section.
 *
 * Wrap each top-level card in the team hub (Phase 4) with one of these so
 * a crash in one card black-outs only that card, not the whole page. The
 * `sectionName` prop surfaces in Sentry context + the fallback heading.
 *
 * @module components/gnolove/SectionErrorBoundary
 */

import { Component } from "react"
import * as Sentry from "@sentry/react"
import type { ReactNode, ErrorInfo } from "react"

interface Props {
    children: ReactNode
    sectionName: string
    onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
    hasError: boolean
}

export class SectionErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false }

    static getDerivedStateFromError(): State {
        return { hasError: true }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[Gnolove/${this.props.sectionName}] ErrorBoundary caught:`, error, info.componentStack)
        Sentry.captureException(error, {
            tags: { section: "gnolove", component: this.props.sectionName },
            contexts: { react: { componentStack: info.componentStack ?? "" } },
        })
        this.props.onError?.(error, info)
    }

    private handleReset = () => {
        this.setState({ hasError: false })
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="gl-empty" role="alert" style={{ margin: 20 }}>
                    <h3 style={{ color: "var(--color-danger)", fontSize: 16, marginBottom: 8 }}>
                        ⚠️ {this.props.sectionName} unavailable
                    </h3>
                    <p>Something went wrong loading this section. The rest of the page should still work.</p>
                    <button
                        className="gl-filter-btn gl-filter-btn--active"
                        style={{ marginTop: 12 }}
                        onClick={this.handleReset}
                    >
                        Try again
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}
