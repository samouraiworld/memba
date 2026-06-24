/**
 * Directory URL schema — shareable query-string state for /:network/directory.
 *
 * Encodes the active tab and the global search query as URL params, so a view
 * is deep-linkable and the browser back button restores it. Mirrors the gnolove
 * report-URL pattern: parse(params) → state, serialize(state) → params, with
 * defaults omitted for minimal URLs. Never throws.
 *
 * @module lib/directoryUrl
 */

export type DirectoryTab =
    | "daos" | "tokens" | "packages" | "realms" | "users" | "govdao" | "leaderboard"

/** Canonical tab order — also the source of truth for URL validation + keyboard nav. */
export const DIRECTORY_TAB_KEYS: readonly DirectoryTab[] = [
    "daos", "tokens", "packages", "realms", "users", "govdao", "leaderboard",
]

export const DEFAULT_DIRECTORY_TAB: DirectoryTab = "daos"

export interface DirectoryUrlState {
    tab: DirectoryTab
    /** Global search query (raw text). */
    q: string
}

/** Cap the query length to keep URLs sane and avoid pathological input. */
const MAX_Q_LEN = 200

const TAB_SET: ReadonlySet<string> = new Set(DIRECTORY_TAB_KEYS)

/** Parse a `URLSearchParams` into validated directory state. Bad input → defaults. */
export function parseDirectoryUrl(params: URLSearchParams): DirectoryUrlState {
    const tabRaw = params.get("tab")
    const tab: DirectoryTab = tabRaw && TAB_SET.has(tabRaw) ? (tabRaw as DirectoryTab) : DEFAULT_DIRECTORY_TAB
    const q = (params.get("q") ?? "").slice(0, MAX_Q_LEN)
    return { tab, q }
}

/** Serialize directory state to `URLSearchParams`, omitting defaults. */
export function serializeDirectoryUrl(s: DirectoryUrlState): URLSearchParams {
    const out = new URLSearchParams()
    if (s.tab !== DEFAULT_DIRECTORY_TAB) out.set("tab", s.tab)
    if (s.q.trim() !== "") out.set("q", s.q)
    return out
}
