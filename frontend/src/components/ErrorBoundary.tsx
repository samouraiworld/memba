import { Component, type ReactNode, type ErrorInfo, useSyncExternalStore } from "react"
import * as Sentry from "@sentry/react"
import { tryChunkReload, isStaleChunkError } from "../lib/staleChunk"

import { isWalletRequestPending, subscribeWalletActivity } from "../lib/walletActivity"

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

        // Record the failure before attempting recovery.
        const stale = isStaleChunkError(error)
        Sentry.captureException(error, {
            tags: { memba_boundary: "root", memba_stale_chunk: stale ? "yes" : "no" },
            contexts: { react: { componentStack: errorInfo.componentStack } },
        })

        if (stale) tryChunkReload()
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
                            {isChunkError ? "Page could not load" : "Something went wrong"}
                        </h2>
                        <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
                            {isChunkError
                                ? "Part of Memba could not load. Check your connection, then reload to try again."
                                : "An unexpected error occurred. Please try reloading the page."}
                        </p>
                        {!isChunkError && this.state.error && (
                            <pre style={{
                                fontSize: "var(--pro-caption, 10px)", color: "var(--color-danger)", background: "rgba(255,71,87,0.06)",
                                padding: 12, borderRadius: 6, marginBottom: 20,
                                textAlign: "left", overflow: "auto", maxHeight: 120,
                                border: "1px solid rgba(255,71,87,0.1)",
                            }}>
                                {this.state.error.message}
                            </pre>
                        )}
                        <RecoveryButton />
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}

function RecoveryButton() {
    const pending = useSyncExternalStore(subscribeWalletActivity, isWalletRequestPending)
    return <>
        {pending && <p id="wallet-recovery-status" role="status">Finish the request in your wallet before reloading. If it was submitted, check its result before trying again.</p>}
        <button
            disabled={pending}
            aria-describedby={pending ? "wallet-recovery-status" : undefined}
                            onClick={() => {
                                if (!isWalletRequestPending()) window.location.reload()
                            }}
                            style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                height: 40, padding: "0 20px", borderRadius: 8,
                                background: "var(--color-brand)", color: "var(--color-text-contrast)", fontSize: "var(--pro-body, 14px)",
                                fontWeight: 600, border: "none", cursor: "pointer",
                                boxShadow: "0 0 24px rgba(0,212,170,0.2)",
                            }}
                        >
                            Reload Page
                        </button>
    </>
}
