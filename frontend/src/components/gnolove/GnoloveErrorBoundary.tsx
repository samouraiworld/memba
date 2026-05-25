import { Component, type ReactNode, type ErrorInfo } from "react"
import * as Sentry from "@sentry/react"

type Variant = "section" | "card"

interface Props {
    name: string
    children: ReactNode
    variant?: Variant
    onError?: (error: Error, info: ErrorInfo) => void
    onRetry?: () => void
    fallback?: (error: Error, name: string) => ReactNode
}

interface State {
    error: Error | null
}

export class GnoloveErrorBoundary extends Component<Props, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        const { name, variant = "section" } = this.props
        const tag = variant === "card" ? { card: name } : { component: name }
        console.error(`[Gnolove/${name}]`, error, info.componentStack)
        Sentry.captureException(error, {
            tags: { section: "gnolove", ...tag },
            contexts: { react: { componentStack: info.componentStack ?? "" } },
        })
        this.props.onError?.(error, info)
    }

    private handleRetry = () => {
        this.setState({ error: null })
        this.props.onRetry?.()
    }

    render() {
        if (!this.state.error) return this.props.children

        const { name, variant = "section", fallback } = this.props

        if (fallback) return fallback(this.state.error, name)

        if (variant === "card") {
            return (
                <div className="gl-thub-card gl-thub-card-error" role="alert">
                    <h3 className="gl-thub-card-title">{name}</h3>
                    <p className="gl-thub-card-error-msg">
                        Couldn't load this card. The rest of the page should still work.
                    </p>
                    <button
                        className="gl-filter-btn gl-filter-btn--active gl-thub-retry-btn"
                        onClick={this.handleRetry}
                    >
                        Retry
                    </button>
                </div>
            )
        }

        return (
            <div className="gl-empty" role="alert" style={{ margin: 20 }}>
                <h3 style={{ color: "var(--color-danger)", fontSize: 16, marginBottom: 8 }}>
                    ⚠️ {name} unavailable
                </h3>
                <p>Something went wrong loading this section. The rest of the page should still work.</p>
                <button
                    className="gl-filter-btn gl-filter-btn--active"
                    style={{ marginTop: 12 }}
                    onClick={this.handleRetry}
                >
                    Try again
                </button>
            </div>
        )
    }
}
