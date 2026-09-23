import { useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { NETWORKS, storedNetworkKey } from "../lib/config"

/**
 * Returns the current network key from the URL /:network param.
 * Outside a /:network route, falls back to the same rule as the redirects
 * (`storedNetworkKey`): the explicit choice if it names a visible network, else
 * DEFAULT_NETWORK. It used to read the raw URL echo (`memba_network`), which
 * could hand back a hidden or retired network (pearl) the redirects never use.
 */
export function useNetworkKey(): string {
    const { network } = useParams<{ network: string }>()
    if (network && NETWORKS[network]) return network
    return storedNetworkKey()
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
