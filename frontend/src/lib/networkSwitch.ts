import { NETWORKS } from "./config"

const STORAGE_KEY = "memba_network"

/**
 * Build the URL to navigate to when switching to Gno network `key`, preserving the
 * current path but swapping the leading `/:network` segment. Pure — exported for tests.
 */
export function networkUrl(key: string, currentPath: string): string {
    const segments = currentPath.split("/").filter(Boolean)
    const firstSegment = segments[0]
    // Strip a leading network segment if the path already carries one.
    const restPath = firstSegment && NETWORKS[firstSegment] ? "/" + segments.slice(1).join("/") : currentPath
    return `/${key}${restPath || "/dashboard"}`
}

/**
 * Persist the selected Gno network and navigate to its URL prefix.
 *
 * This is the single source of the reload-on-switch contract. config.ts computes every
 * network-derived const (GNO_CHAIN_ID, GNO_RPC_URL, USER_REGISTRY, …) once at import, so
 * the only correct way to switch networks is a full navigation that re-runs the module and
 * re-freezes those consts. Both `useNetwork` and the Chain Abstraction Layer's `switchChain`
 * go through here, so the CAL can never switch a Gno network without the reload that keeps
 * `assertWalletBroadcastSafe` comparing against the right chain (B-3).
 */
export function switchGnoNetwork(key: string): void {
    if (!NETWORKS[key]) return
    localStorage.setItem(STORAGE_KEY, key)
    window.location.href = networkUrl(key, window.location.pathname)
}
