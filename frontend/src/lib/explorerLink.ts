/**
 * explorerLink — build the in-app Explorer route for a realm path.
 *
 * Pure helpers shared by {@link ExplorerLink} and the Explorer page so the
 * cross-link target and the viewer agree on normalization. The Explorer route is
 * `/{networkKey}/explorer/<relpath>`, where `relpath` is the bare pkgpath
 * (`r/x/y`) that `Explorer.toRealmPath` re-normalizes to `gno.land/r/x/y`.
 *
 * @module lib/explorerLink
 */

/**
 * Reduce a realm path to the bare pkgpath the Explorer route expects. Strips a
 * leading protocol/host, the `gno.land` prefix, and any render/help/query suffix
 * (`:render`, `$help`, `?a=b`) — mirroring `Explorer.toRealmPath` so a link and
 * the viewer round-trip. Returns "" for an empty/unusable path.
 */
export function toExplorerRelPath(realmPath: string): string {
    let p = (realmPath || "").trim().replace(/^https?:\/\/[^/]+/, "")
    p = p.replace(/^gno\.land/, "").replace(/^\/+/, "")
    p = p.replace(/[:$?].*$/, "").replace(/\/+$/, "")
    return p
}

/**
 * In-app Explorer route for a realm on a given network, or "" if the path is
 * unusable (callers should render nothing in that case).
 */
export function explorerHref(networkKey: string, realmPath: string): string {
    const rel = toExplorerRelPath(realmPath)
    return rel ? `/${networkKey}/explorer/${rel}` : ""
}
