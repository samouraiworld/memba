import { Component, type ReactNode, type ErrorInfo } from "react"
import * as Sentry from "@sentry/react"
import { CHUNK_RELOAD_KEY, isStaleChunkError } from "../lib/staleChunk"

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
 *
 * Catches unhandled errors in the component tree and shows a fallback UI
 * instead of a blank white screen.
 *
 * **Stale chunk auto-recovery**: When a Vite lazy-loaded chunk fails
 * (e.g. after a deploy changes chunk hashes), auto-reloads once.
 * Uses sessionStorage guard to prevent infinite reload loops.
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

        // W6.5: the ROOT boundary never reported — app-wide render crashes
        // were invisible in Sentry (only the alerts/gnolove boundaries
        // captured). Captured BEFORE the stale-chunk early-return and tagged,
        // so auto-reload events are filterable noise but persistent
        // stale-chunk LOOPS are finally visible (componentDidMount clears the
        // reload guard on every successful boot, so a chunk that keeps dying
        // reloads once per boot — invisible without this). No-op when
        // Sentry.init didn't run (DSN unset).
        const stale = isStaleChunkError(error)
        Sentry.captureException(error, {
            tags: { memba_boundary: "root", memba_stale_chunk: stale ? "yes" : "no" },
            contexts: { react: { componentStack: errorInfo.componentStack } },
        })

        // Stale chunk auto-recovery: reload once, guard with sessionStorage
        if (stale) {
            const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY)
            if (!alreadyReloaded) {
                console.warn("[ErrorBoundary] Stale chunk detected — auto-reloading")
                sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
                window.location.reload()
                return
            }
            // Already reloaded once — fall through to show UI
            console.warn("[ErrorBoundary] Stale chunk persists after reload — showing fallback")
        }
    }

    componentDidMount() {
        // Clear the stale chunk reload flag on successful mount (page loaded OK).
        // Only on an error-free mount: when a child dies during the initial
        // render, React runs this mount hook BEFORE componentDidCatch, and an
        // unconditional clear would erase the reload budget right before the
        // catch reads it — a genuinely broken deploy would reload-loop on boot
        // instead of showing the update card.
        if (!this.state.hasError) sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback

            const isChunkError = this.state.error && isStaleChunkError(this.state.error)

            return (
                <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", minHeight: "80vh", padding: 32,
                    fontFamily: "'JetBrains Mono', monospace", color: "var(--color-text)",
                }}>
                    <div style={{
                        background: "var(--color-surface-deep)", border: "1px solid var(--color-surface-raised)", borderRadius: 12,
                        padding: 32, textAlign: "center", maxWidth: 420,
                    }}>
                        <div style={{ fontSize: 40, marginBottom: 16 }}>
                            {isChunkError ? "🔄" : "⚠️"}
                        </div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                            {isChunkError ? "New version available" : "Something went wrong"}
                        </h2>
                        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
                            {isChunkError
                                ? "Memba has been updated. Please reload to get the latest version."
                                : "An unexpected error occurred. Please try reloading the page."}
                        </p>
                        {!isChunkError && this.state.error && (
                            <pre style={{
                                fontSize: 10, color: "var(--color-danger)", background: "rgba(255,71,87,0.06)",
                                padding: 12, borderRadius: 6, marginBottom: 20,
                                textAlign: "left", overflow: "auto", maxHeight: 120,
                                border: "1px solid rgba(255,71,87,0.1)",
                            }}>
                                {this.state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={() => {
                                sessionStorage.removeItem(CHUNK_RELOAD_KEY)
                                window.location.reload()
                            }}
                            style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                height: 40, padding: "0 20px", borderRadius: 8,
                                background: "var(--color-brand)", color: "var(--color-text-contrast)", fontSize: 14,
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
