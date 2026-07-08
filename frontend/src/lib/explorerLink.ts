/**
 * explorerLink — build the in-app Explorer route for a realm path.
 *
 * Pure helpers shared by {@link ExplorerLink} and the Explorer tab so the
 * cross-link target and the viewer agree on normalization. The Explorer now lives
 * as a Directory tab, so the target is
 * `/{networkKey}/directory?tab=explorer&realm=<relpath>`, where `relpath` is the
 * bare pkgpath (`r/x/y`) the viewer re-normalizes to `gno.land/r/x/y`.
 * (Legacy `/{net}/explorer/<relpath>` links redirect here.)
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
 * In-app Explorer route (Directory explorer tab) for a realm on a given network,
 * or "" if the path is unusable (callers should render nothing in that case).
 */
export function explorerHref(networkKey: string, realmPath: string): string {
    const rel = toExplorerRelPath(realmPath)
    return rel ? `/${networkKey}/directory?tab=explorer&realm=${rel}` : ""
}
