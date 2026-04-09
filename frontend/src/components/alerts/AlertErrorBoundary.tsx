/**
 * AlertErrorBoundary — Dedicated error boundary for the alerting feature (F4).
 *
 * Catches Clerk SDK initialization failures, network errors, and any
 * unexpected exceptions within the /alerts page. Does NOT crash the
 * entire app — user can navigate away normally.
 *
 * @module components/alerts/AlertErrorBoundary
 */

import { Component, type ReactNode, type ErrorInfo } from "react"
import * as Sentry from "@sentry/react"

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

export class AlertErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("[AlertErrorBoundary]", error, errorInfo.componentStack)
        Sentry.captureException(error, {
            tags: { feature: "alerting" },
            extra: { componentStack: errorInfo.componentStack },
        })
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", minHeight: "40vh", padding: 32,
                    fontFamily: "'JetBrains Mono', monospace", color: "var(--color-text)",
                }}>
                    <div style={{
                        background: "#141414", border: "1px solid #222", borderRadius: 12,
                        padding: 32, textAlign: "center", maxWidth: 420,
                    }}>
                        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
                        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                            Alerting service unavailable
                        </h2>
                        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
                            The alerting feature encountered an error. You can continue
                            using other Memba features while we resolve this.
                        </p>
                        {this.state.error && (
                            <pre style={{
                                fontSize: 10, color: "var(--color-danger)",
                                background: "rgba(255,71,87,0.06)",
                                padding: 12, borderRadius: 6, marginBottom: 20,
                                textAlign: "left", overflow: "auto", maxHeight: 80,
                                border: "1px solid rgba(255,71,87,0.1)",
                            }}>
                                {this.state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={() => this.setState({ hasError: false, error: null })}
                            style={{
                                display: "inline-flex", alignItems: "center",
                                justifyContent: "center", height: 36, padding: "0 18px",
                                borderRadius: 8, background: "#00d4aa", color: "#000",
                                fontSize: 12, fontWeight: 600, border: "none",
                                cursor: "pointer", boxShadow: "0 0 24px rgba(0,212,170,0.2)",
                            }}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
