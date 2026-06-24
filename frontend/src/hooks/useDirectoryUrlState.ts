/**
 * useDirectoryUrlState — bridges `useSearchParams` with the directory URL schema.
 *
 * Returns `[state, setState]`. State is parsed from the URL on every render
 * (the parser is microseconds); `setState` accepts a partial patch. History
 * strategy: `tab` pushes (browser-back walks the tabs); `q` replaces (per-keystroke
 * text shouldn't pollute history). Mirrors `useReportUrlState`.
 *
 * @module hooks/useDirectoryUrlState
 */

import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
    parseDirectoryUrl,
    serializeDirectoryUrl,
    type DirectoryUrlState,
} from "../lib/directoryUrl"

/** Axes that use `replace` history semantics (don't pollute history). */
const REPLACE_AXES: ReadonlySet<keyof DirectoryUrlState> = new Set(["q"])

function isReplaceUpdate(patch: Partial<DirectoryUrlState>): boolean {
    const keys = Object.keys(patch) as (keyof DirectoryUrlState)[]
    return keys.length > 0 && keys.every(k => REPLACE_AXES.has(k))
}

export function useDirectoryUrlState(): [
    DirectoryUrlState,
    (patch: Partial<DirectoryUrlState>) => void,
] {
    const [searchParams, setSearchParams] = useSearchParams()

    const state = useMemo(() => parseDirectoryUrl(searchParams), [searchParams])

    const setState = useCallback(
        (patch: Partial<DirectoryUrlState>) => {
            const replace = isReplaceUpdate(patch)
            setSearchParams(
                prev => serializeDirectoryUrl({ ...parseDirectoryUrl(prev), ...patch }),
                { replace },
            )
        },
        [setSearchParams],
    )

    return [state, setState]
}
