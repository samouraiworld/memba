/**
 * useGnoloveTeams — seed + fetched union for the gnolove team roster.
 *
 * Phase 3 (2026-05) moved the source of truth to the gnolove backend's
 * `config/teams.yaml`. The frontend keeps the {@link TEAMS} constant as a
 * SEED so:
 *   - first paint isn't blocked on a network round-trip,
 *   - URL-state validation (which is sync) still works,
 *   - offline / backend-down callers still see a sensible roster.
 *
 * Consumers that need teams in React rendering should call this hook.
 * Consumers that need them in sync code (URL parsers, e.g.) should
 * import {@link TEAMS} directly.
 *
 * @module hooks/gnolove/useGnoloveTeams
 */

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import * as api from "../../lib/gnoloveApi"
import { TEAMS, type Team, type TeamColor } from "../../lib/gnoloveConstants"
import type { TBackendTeam } from "../../lib/gnoloveSchemas"

const STALE_TEAMS = 5 * 60_000 // 5 min — roster changes are Lours-deploy slow

const SEED_BY_SLUG = new Map(TEAMS.map(t => [t.slug.toLowerCase(), t]))

const TEAM_COLORS = new Set<TeamColor>([
    "blue", "yellow", "purple", "red", "green", "brown", "pink",
])

/**
 * Coerce a backend team into the frontend {@link Team} shape.
 * Unknown colors fall back to "blue" rather than blanking the row.
 */
export function backendTeamToFrontend(t: TBackendTeam): Team {
    const color: TeamColor = TEAM_COLORS.has(t.color as TeamColor) ? (t.color as TeamColor) : "blue"
    const seed = SEED_BY_SLUG.get(t.slug.toLowerCase())
    return {
        slug: t.slug,
        name: t.name,
        color,
        description: t.description,
        members: t.members ?? [],
        logoUrl: seed?.logoUrl,
        website: seed?.website,
        twitter: seed?.twitter,
    }
}

export interface UseGnoloveTeamsResult {
    /** Live roster if the backend responded, otherwise the build-time seed. */
    teams: Team[]
    /** True iff `teams` was returned by the backend on this session. */
    isFetched: boolean
    /** ISO timestamp from the backend response, or null while pending. */
    lastSyncedAt: string | null
    /** Underlying TanStack Query state for callers that want loading / error. */
    isLoading: boolean
    error: unknown
}

/**
 * Always returns a populated roster. While the request is in-flight or after
 * a failure, the seed roster is served. Once the backend replies successfully,
 * its roster replaces the seed for the rest of the session.
 */
export function useGnoloveTeams(): UseGnoloveTeamsResult {
    const { data, isLoading, error } = useQuery({
        queryKey: ["gnolove", "teams"],
        queryFn: ({ signal }) => api.getTeams(signal),
        staleTime: STALE_TEAMS,
    })

    return useMemo(() => {
        if (data && data.teams.length > 0) {
            return {
                teams: data.teams.map(backendTeamToFrontend),
                isFetched: true,
                lastSyncedAt: data.lastSyncedAt,
                isLoading,
                error,
            }
        }
        return {
            teams: TEAMS,
            isFetched: false,
            lastSyncedAt: null,
            isLoading,
            error,
        }
    }, [data, isLoading, error])
}

/**
 * Look up one team by slug from the union roster.
 * Case-insensitive to mirror the backend's `FindBySlug`.
 */
export function useGnoloveTeam(slug: string | undefined): Team | null {
    const { teams } = useGnoloveTeams()
    return useMemo(() => {
        if (!slug) return null
        const lower = slug.toLowerCase()
        return teams.find(t => t.slug.toLowerCase() === lower) ?? null
    }, [teams, slug])
}

/**
 * Dual-threshold active repos for a team.
 *
 * `enabled` defaults to true when slug is present; toggle off for places
 * that render the hook but only need the data once a team is selected.
 */
export function useGnoloveTeamActiveRepos(slug: string | undefined, period = "", enabled = true) {
    return useQuery({
        queryKey: ["gnolove", "teamActiveRepos", slug, period],
        queryFn: ({ signal }) => api.getTeamActiveRepos(slug!, period, signal),
        enabled: enabled && !!slug,
        staleTime: STALE_TEAMS,
    })
}

/**
 * (repo, author) GROUP BY stats for a team.
 */
export function useGnoloveTeamStats(slug: string | undefined, period = "", repos: string[] = [], enabled = true) {
    return useQuery({
        queryKey: ["gnolove", "teamStats", slug, period, repos],
        queryFn: ({ signal }) => api.getTeamStats(slug!, period, repos, signal),
        enabled: enabled && !!slug,
        staleTime: STALE_TEAMS,
    })
}
