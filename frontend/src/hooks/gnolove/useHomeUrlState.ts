/**
 * useHomeUrlState — URL-bound state for /:network/gnolove (scoreboard page).
 *
 * Same push/replace contract as useReportUrlState: coarse-axis changes use
 * push so back-button walks back through filter changes.
 *
 * Plan: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §8 Task 2.1.
 *
 * @module hooks/gnolove/useHomeUrlState
 */

import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
    parseHomeUrl, serializeHomeUrl,
    type HomeUrlState,
} from "../../lib/gnoloveHomeUrl"

export function useHomeUrlState(): [
    HomeUrlState,
    (patch: Partial<HomeUrlState>) => void,
] {
    const [searchParams, setSearchParams] = useSearchParams()

    const state = useMemo(() => parseHomeUrl(searchParams), [searchParams])

    // All Home axes are coarse — every change uses push so back-button walks back.
    const setState = useCallback(
        (patch: Partial<HomeUrlState>) => {
            setSearchParams(
                prev => serializeHomeUrl({ ...parseHomeUrl(prev), ...patch }),
                { replace: false },
            )
        },
        [setSearchParams],
    )

    return [state, setState]
}
