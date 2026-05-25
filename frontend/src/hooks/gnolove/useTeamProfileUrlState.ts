/**
 * useTeamProfileUrlState — URL-backed period + repo selection for the team hub.
 *
 * Round-trips:
 *   - `?period=monthly` (one of TEAM_HUB_PERIODS, falls back to default)
 *   - `?repo=org/name` (repeatable; case-preserved)
 *
 * Same shareable-URL approach as `useReportUrlState` / `useHomeUrlState`.
 * Garbage values fall back to defaults rather than throwing — link rot
 * shouldn't blank the page.
 *
 * @module hooks/gnolove/useTeamProfileUrlState
 */

import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
    DEFAULT_TEAM_HUB_PERIOD,
    parseTeamHubPeriod,
    type TeamHubPeriod,
} from "../../lib/gnolovePeriod"

const REPO_CHARSET = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export interface TeamProfileUrlState {
    period: TeamHubPeriod
    repos: string[]
    setPeriod: (next: TeamHubPeriod) => void
    setRepos: (next: string[]) => void
    toggleRepo: (repoId: string) => void
}

export function useTeamProfileUrlState(): TeamProfileUrlState {
    const [params, setParams] = useSearchParams()

    const period = useMemo(
        () => parseTeamHubPeriod(params.get("period")),
        [params],
    )

    const repos = useMemo(() => {
        const all = params.getAll("repo")
        // Drop anything that doesn't look like owner/name to keep the backend
        // query honest. Order preserved.
        return all.filter(r => REPO_CHARSET.test(r))
    }, [params])

    const setPeriod = useCallback((next: TeamHubPeriod) => {
        setParams(prev => {
            const out = new URLSearchParams(prev)
            if (next === DEFAULT_TEAM_HUB_PERIOD) {
                out.delete("period")
            } else {
                out.set("period", next)
            }
            return out
        }, { replace: true })
    }, [setParams])

    const setRepos = useCallback((next: string[]) => {
        setParams(prev => {
            const out = new URLSearchParams(prev)
            out.delete("repo")
            for (const r of next) {
                if (REPO_CHARSET.test(r)) out.append("repo", r)
            }
            return out
        }, { replace: true })
    }, [setParams])

    const toggleRepo = useCallback((repoId: string) => {
        if (!REPO_CHARSET.test(repoId)) return
        setParams(prev => {
            const out = new URLSearchParams(prev)
            const existing = out.getAll("repo")
            out.delete("repo")
            if (existing.includes(repoId)) {
                for (const r of existing) {
                    if (r !== repoId) out.append("repo", r)
                }
            } else {
                for (const r of existing) out.append("repo", r)
                out.append("repo", repoId)
            }
            return out
        }, { replace: true })
    }, [setParams])

    return { period, repos, setPeriod, setRepos, toggleRepo }
}
