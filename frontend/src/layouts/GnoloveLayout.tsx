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

import { useState, useEffect, Suspense } from "react"
import { Outlet } from "react-router-dom"
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query"
import * as Sentry from "@sentry/react"
import { persistQueryClient } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import GnoloveSubNav from "../components/gnolove/GnoloveSubNav"
import { GnoloveErrorBoundary } from "../components/gnolove/GnoloveErrorBoundary"
import { useFocusOnRouteChange } from "../hooks/useFocusOnRouteChange"
import "../pages/gnolove/gnolove.css"

// Bumped v1 → v2 in Phase 3 (2026-05) so the new `["gnolove", "teams"]`
// queries don't get served from a v1 cache that doesn't know about them.
// Plan R-6 mitigation. The old v1 entry stays orphaned in localStorage
// until the user's next gc — harmless, not worth a one-shot cleanup.
const CACHE_KEY = "gnolove-cache-v2"
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000 // 24h

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
    useFocusOnRouteChange()
    const [queryClient] = useState(
        () =>
            new QueryClient({
                queryCache: new QueryCache({
                    onError: (error, query) => {
                        Sentry.addBreadcrumb({
                            category: "gnolove.query",
                            message: `Query failed: ${JSON.stringify(query.queryKey)}`,
                            level: "error",
                            data: {
                                queryKey: query.queryKey,
                                error: error instanceof Error ? error.message : String(error),
                            },
                        })
                    },
                }),
                defaultOptions: {
                    queries: {
                        staleTime: 30_000,
                        retry: (failureCount, error) =>
                            failureCount < 2 &&
                            error instanceof Error &&
                            "status" in error &&
                            (error as { status: number }).status >= 500,
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
                <GnoloveErrorBoundary name="Gnolove">
                    <Suspense fallback={<GnolovePageLoader />}>
                        <Outlet />
                    </Suspense>
                </GnoloveErrorBoundary>
            </div>
        </QueryClientProvider>
    )
}
