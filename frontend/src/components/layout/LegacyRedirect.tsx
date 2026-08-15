/**
 * LegacyRedirect — Redirects old URLs without /:network prefix to the new format.
 *
 * Catches all paths that don't match a known network key and redirects to
 * /:storedNetwork/path, preserving the original path and search params.
 *
 * Examples:
 *   /dashboard → /sapphire/dashboard
 *   /dao/gno.land~r~gov~dao → /sapphire/dao/gno.land~r~gov~dao
 *   /gnolove/teams → /sapphire/gnolove/teams
 */
import { Navigate, useLocation } from "react-router-dom"
import { resolveStoredNetworkKey } from "../../lib/config"

export function LegacyRedirect() {
    const location = useLocation()
    // Self-heals away from a hidden network — see resolveStoredNetworkKey.
    //
    // This is a NAVIGATION resolver and must use the same rule as RootRedirect.
    // It used to inline `(stored && NETWORKS[stored]) ? stored : DEFAULT_NETWORK`,
    // which has no `hidden` check — and since NetworkGate routes EVERY legacy /
    // bookmarked URL through here, a stored `gnoland1` sent `/directory` to
    // `/gnoland1/directory` while `/` correctly healed to the default network. Bookmarks
    // stayed pinned to a network the switcher no longer offers.
    const network = resolveStoredNetworkKey(localStorage.getItem("memba_network"))

    // Preserve path + search + hash
    const target = `/${network}${location.pathname}${location.search}${location.hash}`
    return <Navigate to={target} replace />
}
