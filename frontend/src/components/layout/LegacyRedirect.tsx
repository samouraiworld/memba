/**
 * LegacyRedirect — Redirects old URLs without /:network prefix to the new format.
 *
 * Catches all paths that don't match a known network key and redirects to
 * /:storedNetwork/path, preserving the original path and search params.
 *
 * Examples:
 *   /dashboard → /pearl/dashboard
 *   /dao/gno.land~r~gov~dao → /pearl/dao/gno.land~r~gov~dao
 *   /gnolove/teams → /pearl/gnolove/teams
 */
import { Navigate, useLocation } from "react-router-dom"
import { storedNetworkKey } from "../../lib/config"

export function LegacyRedirect() {
    const location = useLocation()
    // The same rule as RootRedirect and config.ts's module load — see
    // `resolveNetworkKey`: an explicit choice outranks the URL echo, and a hidden
    // network is never restored from storage.
    //
    // It used to inline `(stored && NETWORKS[stored]) ? stored : DEFAULT_NETWORK`,
    // which has no `hidden` check — and since NetworkGate routes EVERY legacy /
    // bookmarked URL through here, a stored `gnoland1` sent `/directory` to
    // `/gnoland1/directory` while `/` correctly healed to the default network. Bookmarks
    // stayed pinned to a network the switcher no longer offers.
    const network = storedNetworkKey()

    // Preserve path + search + hash
    const target = `/${network}${location.pathname}${location.search}${location.hash}`
    return <Navigate to={target} replace />
}
