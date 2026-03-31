/**
 * LegacyRedirect — Redirects old URLs without /:network prefix to the new format.
 *
 * Catches all paths that don't match a known network key and redirects to
 * /:storedNetwork/path, preserving the original path and search params.
 *
 * Examples:
 *   /dashboard → /test12/dashboard
 *   /dao/gno.land~r~gov~dao → /test12/dao/gno.land~r~gov~dao
 *   /gnolove/teams → /test12/gnolove/teams
 */
import { Navigate, useLocation } from "react-router-dom"
import { NETWORKS, DEFAULT_NETWORK } from "../../lib/config"

export function LegacyRedirect() {
    const location = useLocation()
    const stored = localStorage.getItem("memba_network")
    const network = (stored && NETWORKS[stored]) ? stored : DEFAULT_NETWORK

    // Preserve path + search + hash
    const target = `/${network}${location.pathname}${location.search}${location.hash}`
    return <Navigate to={target} replace />
}
