/**
 * useGnoloveTopics — seed + fetched union for the Focus Areas taxonomy.
 *
 * Phase 2c (2026-05) moved the source of truth to the gnolove backend's
 * `config/topics.yaml`. The frontend keeps a build-time copy of the rule
 * bag inside `lib/gnoloveFocusAreas.ts` as a SEED so:
 *   - first paint isn't blocked on a network round-trip,
 *   - offline / backend-down callers still classify PRs,
 *   - SSR-equivalent code paths that can't await a hook still work.
 *
 * Once the backend responds, its taxonomy replaces the seed for the
 * rest of the session. Consumers should pass `rules` into
 * {@link computeFocusAreas} and look topic labels up in `labels`.
 *
 * @module hooks/gnolove/useGnoloveTopics
 */

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import * as api from "../../lib/gnoloveApi"
import {
    compileBackendTopics,
    type FocusTopic,
    type TopicRule,
    _internals,
    FOCUS_TOPIC_LABELS,
} from "../../lib/gnoloveFocusAreas"

const STALE_TOPICS = 5 * 60_000 // 5 min — taxonomy is Lours-deploy slow

export interface UseGnoloveTopicsResult {
    /** Compiled topic rules. Pass into `computeFocusAreas(signals, rules)`. */
    rules: TopicRule[]
    /** Slug → user-visible label. Backend wins for known slugs; seed fallback. */
    labels: Record<FocusTopic, string>
    /** True iff `rules` came from the backend on this session. */
    isFetched: boolean
    /** ISO timestamp from the backend response, or null while pending. */
    lastSyncedAt: string | null
    /** Underlying TanStack Query state for callers that want loading / error. */
    isLoading: boolean
    error: unknown
}

/**
 * Always returns a populated rule set. While the request is in-flight or
 * after a failure, the build-time seed is served. Once the backend
 * replies successfully, its taxonomy replaces the seed.
 */
export function useGnoloveTopics(): UseGnoloveTopicsResult {
    const { data, isLoading, error } = useQuery({
        queryKey: ["gnolove", "topics"],
        queryFn: ({ signal }) => api.getTopics(signal),
        staleTime: STALE_TOPICS,
    })

    return useMemo(() => {
        if (data && data.topics.length > 0) {
            const { rules, labels } = compileBackendTopics(data.topics)
            return {
                rules,
                labels,
                isFetched: true,
                lastSyncedAt: data.lastSyncedAt,
                isLoading,
                error,
            }
        }
        return {
            rules: _internals.SEED_TOPIC_RULES,
            labels: FOCUS_TOPIC_LABELS,
            isFetched: false,
            lastSyncedAt: null,
            isLoading,
            error,
        }
    }, [data, isLoading, error])
}
