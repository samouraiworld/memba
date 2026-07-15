/**
 * Shared React Query client — app-wide singleton.
 *
 * Lifted verbatim from GnoloveLayout (Task 0.2) so the home-page data layer
 * and any future feature can reuse React Query without a second client.
 *
 * Persistence is scoped to ["gnolove", …] keys only (shouldDehydrateQuery
 * filter), so Memba's own queries are never written to localStorage.
 *
 * @module lib/queryClient
 */

import { QueryClient, QueryCache } from "@tanstack/react-query"
import * as Sentry from "@sentry/react"
import { persistQueryClient } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"

// Bumped v1 → v2 in Phase 3 (2026-05) so the new `["gnolove", "teams"]`
// queries don't get served from a v1 cache that doesn't know about them.
// Plan R-6 mitigation. The old v1 entry stays orphaned in localStorage
// until the user's next gc — harmless, not worth a one-shot cleanup.
const CACHE_KEY = "gnolove-cache-v2"
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000 // 24h

export const queryClient = new QueryClient({
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
            // The live reputation board reads test13 directly; a failure there is otherwise silent
            // (a breadcrumb only surfaces if some OTHER capture fires in the same session). The public
            // board erroring for all users deserves its own alert. Scoped to points board queries only.
            const key = query.queryKey
            if (Array.isArray(key) && key[0] === "points" && key[1] === "board") {
                Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
                    tags: { feature: "points", surface: "leaderboard" },
                })
            }
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
            // W4: never poll a hidden tab. This is React Query's default, but
            // pinning it here makes the posture explicit and stops a future
            // per-query refetchIntervalInBackground:true from slipping in as
            // an unreviewed background-drain regression.
            refetchIntervalInBackground: false,
            gcTime: CACHE_MAX_AGE,
        },
    },
})

// Persist gnolove queries to localStorage for offline resilience.
// Only ["gnolove", …] keys are dehydrated — Memba's own queries stay in-memory.
const persister = createSyncStoragePersister({
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    key: CACHE_KEY,
})

persistQueryClient({
    queryClient,
    persister,
    maxAge: CACHE_MAX_AGE,
    dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === "gnolove",
    },
})
