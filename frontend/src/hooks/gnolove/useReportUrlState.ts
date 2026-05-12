/**
 * useReportUrlState — bridges `useSearchParams` with the gnoloveReportUrl schema.
 *
 * Returns `[state, setState]` where state is parsed from the URL on every render
 * (cheap; the parser is microseconds) and setState accepts a partial update.
 *
 * History strategy [MF-2]:
 *   - `push` on coarse-axis filter changes (period, at, team, tab, repos) so
 *     browser-back walks back through each filter step.
 *   - `replace` on `view` toggle only (it's a sibling-tab affordance, not a
 *     true filter, so it should not pollute history).
 *
 * The returned `setState` is NOT referentially stable across URL changes
 * (RR7's `setSearchParams` rebuilds when `searchParams` changes). Consumers
 * that need stability should consume the setter directly in their JSX
 * callbacks rather than passing it through memoized props.
 *
 * Plan: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §6 Task 0.3.
 *
 * @module hooks/gnolove/useReportUrlState
 */

import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
    parseReportUrl,
    serializeReportUrl,
    type ReportUrlState,
} from "../../lib/gnoloveReportUrl"

/** Axes that should use `replace` history semantics (don't pollute history). */
const REPLACE_AXES: ReadonlySet<keyof ReportUrlState> = new Set(["view"])

function isReplaceUpdate(patch: Partial<ReportUrlState>): boolean {
    const keys = Object.keys(patch) as (keyof ReportUrlState)[]
    return keys.length > 0 && keys.every(k => REPLACE_AXES.has(k))
}

export function useReportUrlState(): [
    ReportUrlState,
    (patch: Partial<ReportUrlState>) => void,
] {
    const [searchParams, setSearchParams] = useSearchParams()

    // RR7 memoizes `searchParams` on [location.search]; use it directly as the dep.
    const state = useMemo(() => parseReportUrl(searchParams), [searchParams])

    const setState = useCallback(
        (patch: Partial<ReportUrlState>) => {
            const replace = isReplaceUpdate(patch)
            setSearchParams(
                prev => serializeReportUrl({ ...parseReportUrl(prev), ...patch }),
                { replace },
            )
        },
        [setSearchParams],
    )

    return [state, setState]
}
