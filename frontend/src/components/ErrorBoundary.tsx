import { Component, type ReactNode, type ErrorInfo } from "react"

interface Props {
    children: ReactNode
    fallback?: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

/**
 * Root-level React error boundary.
 * Catches unhandled errors in the component tree and shows a fallback UI
 * instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("[ErrorBoundary]", error, errorInfo.componentStack)
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback

            return (
                <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", minHeight: "80vh", padding: 32,
                    fontFamily: "'JetBrains Mono', monospace", color: "#f0f0f0",
                }}>
                    <div style={{
                        background: "#141414", border: "1px solid #222", borderRadius: 12,
                        padding: 32, textAlign: "center", maxWidth: 420,
                    }}>
                        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                            Something went wrong
                        </h2>
                        <p style={{ fontSize: 12, color: "#888", marginBottom: 20, lineHeight: 1.6 }}>
                            An unexpected error occurred. Please try reloading the page.
                        </p>
                        {this.state.error && (
                            <pre style={{
                                fontSize: 10, color: "#ff4757", background: "rgba(255,71,87,0.06)",
                                padding: 12, borderRadius: 6, marginBottom: 20,
                                textAlign: "left", overflow: "auto", maxHeight: 120,
                                border: "1px solid rgba(255,71,87,0.1)",
                            }}>
                                {this.state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                height: 40, padding: "0 20px", borderRadius: 8,
                                background: "#00d4aa", color: "#000", fontSize: 14,
                                fontWeight: 600, border: "none", cursor: "pointer",
                                boxShadow: "0 0 24px rgba(0,212,170,0.2)",
                            }}
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
