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

import { QueryClient, QueryCache, defaultShouldDehydrateQuery } from "@tanstack/react-query"
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

// Keep persisted Gnolove reads bounded. Large reports and multiple filters
// stay in memory; if a browser's storage quota is unusually small, evict the
// oldest persisted query and retry instead of leaving the whole cache stale.
const MAX_PERSISTED_QUERY_BYTES = 128_000
type PersistRetry = NonNullable<Parameters<typeof createSyncStoragePersister>[0]["retry"]>
export const evictOldestPersistedQuery: PersistRetry = ({ persistedClient }) => {
    const queries = persistedClient.clientState.queries
    if (!queries.length) return undefined
    const oldest = queries.reduce((first, query) =>
        query.state.dataUpdatedAt < first.state.dataUpdatedAt ? query : first)
    return {
        ...persistedClient,
        clientState: {
            ...persistedClient.clientState,
            queries: queries.filter(query => query !== oldest),
        },
    }
}
const persister = createSyncStoragePersister({
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    key: CACHE_KEY,
    retry: evictOldestPersistedQuery,
})

persistQueryClient({
    queryClient,
    persister,
    maxAge: CACHE_MAX_AGE,
    // Earlier caches included pending promises, which JSON turns into {}.
    // Discard that format before hydration; the read-only data will refetch.
    buster: "gnolove-success-only-v1",
    dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
            if (!defaultShouldDehydrateQuery(query) ||
                !Array.isArray(query.queryKey) ||
                query.queryKey[0] !== "gnolove" ||
                query.queryKey[1] === "report" ||
                query.queryKey[1] === "yearReport") return false
            try {
                const serialized = JSON.stringify(query.state.data)
                return typeof serialized === "string" && serialized.length <= MAX_PERSISTED_QUERY_BYTES
            } catch {
                return false
            }
        },
    },
})
