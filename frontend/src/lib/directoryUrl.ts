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
    | "daos" | "tokens" | "packages" | "realms" | "users" | "govdao" | "leaderboard" | "explorer"

/** Canonical tab order — also the source of truth for URL validation + keyboard nav.
 *  W5.2: Packages first (most-filled tab on test13 today). `explorer` (the merged-in
 *  realm viewer, gated by VITE_ENABLE_EXPLORER) is last — the deep-dive after browse. */
export const DIRECTORY_TAB_KEYS: readonly DirectoryTab[] = [
    "packages", "daos", "realms", "tokens", "users", "govdao", "leaderboard", "explorer",
]

/** W5.2: landing on /directory opens Packages. Old shared URLs that meant
 *  "DAOs" carried no ?tab= param (it was the omitted default) — they now open
 *  Packages by design; explicit ?tab=daos links are unaffected. */
export const DEFAULT_DIRECTORY_TAB: DirectoryTab = "packages"

export interface DirectoryUrlState {
    tab: DirectoryTab
    /** Global search query (raw text). */
    q: string
    /** Explorer tab: the realm path being viewed, as a bare relpath (`r/x/y`).
     *  Empty when no realm is selected (the Explorer tab shows its examples). */
    realm: string
}

/** Cap the query length to keep URLs sane and avoid pathological input. */
const MAX_Q_LEN = 200
/** Cap the realm path length (pkgpaths are short; guards against pathological URLs). */
const MAX_REALM_LEN = 200

const TAB_SET: ReadonlySet<string> = new Set(DIRECTORY_TAB_KEYS)

/** Parse a `URLSearchParams` into validated directory state. Bad input → defaults. */
export function parseDirectoryUrl(params: URLSearchParams): DirectoryUrlState {
    const tabRaw = params.get("tab")
    const tab: DirectoryTab = tabRaw && TAB_SET.has(tabRaw) ? (tabRaw as DirectoryTab) : DEFAULT_DIRECTORY_TAB
    const q = (params.get("q") ?? "").slice(0, MAX_Q_LEN)
    const realm = (params.get("realm") ?? "").trim().slice(0, MAX_REALM_LEN)
    return { tab, q, realm }
}

/** Serialize directory state to `URLSearchParams`, omitting defaults. */
export function serializeDirectoryUrl(s: DirectoryUrlState): URLSearchParams {
    const out = new URLSearchParams()
    if (s.tab !== DEFAULT_DIRECTORY_TAB) out.set("tab", s.tab)
    if (s.q.trim() !== "") out.set("q", s.q)
    // `realm` only carries meaning on the explorer tab; keep it out of other URLs.
    if (s.realm.trim() !== "" && s.tab === "explorer") out.set("realm", s.realm)
    return out
}
