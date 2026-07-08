/**
 * Explorer — legacy `/explorer/*` redirect.
 *
 * The realm viewer was merged into the Directory as a tab (item 4, 2026-07-08),
 * so this route now forwards any old deep-link `/explorer/r/x/y` to the canonical
 * `/directory?tab=explorer&realm=r/x/y`, preserving the realm path. Kept as a
 * lazy route so existing links, bookmarks, and shares don't 404.
 *
 * @module pages/Explorer
 */

import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { toExplorerRelPath } from "../lib/explorerLink"

export function Explorer() {
    const nav = useNetworkNav()
    const splat = useParams()["*"] || ""

    useEffect(() => {
        const rel = toExplorerRelPath(splat)
        nav(rel ? `directory?tab=explorer&realm=${rel}` : "directory?tab=explorer", { replace: true })
    }, [nav, splat])

    return null
}
