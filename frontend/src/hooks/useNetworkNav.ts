import { useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { DEFAULT_NETWORK, NETWORKS } from "../lib/config"

/**
 * Returns the current network key from the URL /:network param.
 * Falls back to localStorage → DEFAULT_NETWORK if not present.
 */
export function useNetworkKey(): string {
    const { network } = useParams<{ network: string }>()
    if (network && NETWORKS[network]) return network
    try {
        const stored = localStorage.getItem("memba_network")
        if (stored && NETWORKS[stored]) return stored
    } catch { /* SSR */ }
    return DEFAULT_NETWORK
}

/**
 * Navigation hook that automatically prepends the /:network/ prefix.
 *
 * Usage:
 *   const nav = useNetworkNav()
 *   nav("dashboard")        → /:network/dashboard
 *   nav("dao/create")       → /:network/dao/create
 *   nav(-1)                 → history back (no prefix)
 */
export function useNetworkNav() {
    const navigate = useNavigate()
    const networkKey = useNetworkKey()

    return useCallback(
        (to: string | number, options?: { replace?: boolean; state?: unknown }) => {
            if (typeof to === "number") {
                navigate(to)
                return
            }
            // Strip leading / and prepend /:network/ prefix
            const clean = to.startsWith("/") ? to.slice(1) : to
            navigate(`/${networkKey}/${clean}`, options)
        },
        [navigate, networkKey],
    )
}

/**
 * Build a network-prefixed path string for <Link to=...> or other uses.
 */
export function useNetworkPath() {
    const networkKey = useNetworkKey()
    return useCallback(
        (path: string) => `/${networkKey}/${path}`,
        [networkKey],
    )
}
