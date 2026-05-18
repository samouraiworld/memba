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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { persistQueryClient } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import GnoloveSubNav from "../components/gnolove/GnoloveSubNav"
import { SectionErrorBoundary } from "../components/gnolove/SectionErrorBoundary"
import "../pages/gnolove/gnolove.css"

const CACHE_KEY = "gnolove-cache-v1"
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
                <SectionErrorBoundary sectionName="Gnolove">
                    <Suspense fallback={<GnolovePageLoader />}>
                        <Outlet />
                    </Suspense>
                </SectionErrorBoundary>
            </div>
        </QueryClientProvider>
    )
}
