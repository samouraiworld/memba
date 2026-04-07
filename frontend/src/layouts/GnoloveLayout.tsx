/**
 * GnoloveLayout — Section-scoped layout with its own React Query instance.
 *
 * QueryClient is created via useState (not useMemo, not module-level).
 * This ensures proper cleanup on unmount while surviving re-renders.
 * All gnolove data is isolated from Memba's core data layer.
 *
 * ErrorBoundary ensures gnolove failures don't crash the entire Memba app.
 * Inner Suspense prevents SubNav disappearing during child route transitions.
 *
 * @module layouts/GnoloveLayout
 */

import { useState, useEffect, Suspense, Component } from "react"
import type { ReactNode, ErrorInfo } from "react"
import { Outlet } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { persistQueryClient } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import GnoloveSubNav from "../components/gnolove/GnoloveSubNav"
import "../pages/gnolove/gnolove.css"

const CACHE_KEY = "gnolove-cache-v1"
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000 // 24h

// ── Error Boundary (crash isolation) ─────────────────────────

interface ErrorBoundaryState {
    hasError: boolean
    error: Error | null
}

class GnoloveErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false, error: null }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[Gnolove] ErrorBoundary caught:", error, info.componentStack)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="gl-empty" style={{ margin: 20 }}>
                    <h2 style={{ color: "#ef4444", fontSize: 16, marginBottom: 8 }}>⚠️ Gnolove Error</h2>
                    <p>Something went wrong loading this section.</p>
                    <button
                        className="gl-filter-btn gl-filter-btn--active"
                        style={{ marginTop: 12 }}
                        onClick={() => this.setState({ hasError: false, error: null })}
                    >
                        Try Again
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}

// ── Section Loader ───────────────────────────────────────────

function GnolovePageLoader() {
    return (
        <div className="gl-loading">
            <div className="gl-skeleton" />
            <div className="gl-skeleton" />
            <div className="gl-skeleton" />
        </div>
    )
}

// ── Layout ───────────────────────────────────────────────────

export default function GnoloveLayout() {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 30_000,
                        retry: 1,
                        refetchOnWindowFocus: false,
                        gcTime: CACHE_MAX_AGE,
                    },
                },
            }),
    )

    // Persist gnolove queries to localStorage for offline resilience
    useEffect(() => {
        const persister = createSyncStoragePersister({
            storage: window.localStorage,
            key: CACHE_KEY,
        })
        const [unsubscribe] = persistQueryClient({
            queryClient,
            persister,
            maxAge: CACHE_MAX_AGE,
            dehydrateOptions: {
                shouldDehydrateQuery: (query) =>
                    Array.isArray(query.queryKey) && query.queryKey[0] === "gnolove",
            },
        })
        return () => { unsubscribe() }
    }, [queryClient])

    return (
        <QueryClientProvider client={queryClient}>
            <div className="gl-layout">
                <GnoloveSubNav />
                <GnoloveErrorBoundary>
                    <Suspense fallback={<GnolovePageLoader />}>
                        <Outlet />
                    </Suspense>
                </GnoloveErrorBoundary>
            </div>
        </QueryClientProvider>
    )
}
