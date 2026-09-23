/**
 * Retired-network redirect helpers (pearl → mainnet since 2026-09-23).
 *
 * Shared by RetiredNetworkRedirect (which builds the successor URL) and
 * RetiredNetworkNotice (which explains the move once). Which networks are
 * retired, and to where, is `NETWORKS[key].retiredTo` — see
 * `retiredNetworkSuccessor` in config.ts.
 *
 * @module lib/retiredNetwork
 */
import { NETWORKS, retiredNetworkSuccessor } from "./config"

/** Router state carried from the redirect to the successor network's page. */
export interface RetiredNetworkState {
    retiredNetwork: string
}

/** The successor path for a location under a retired network prefix,
 *  preserving search and hash: `/pearl/dao/x?y#z` → `/mainnet/dao/x?y#z`. */
export function retiredNetworkTarget(
    { pathname, search, hash }: { pathname: string; search: string; hash: string },
    from: string,
    to: string,
): string {
    const prefix = `/${from}`
    const rest = pathname === prefix || pathname.startsWith(`${prefix}/`)
        ? pathname.slice(prefix.length)
        : pathname
    return `/${to}${rest || "/"}${search}${hash}`
}

/** localStorage key recording that the notice for `retiredKey` was dismissed. */
export function retiredNoticeStorageKey(retiredKey: string): string {
    return `memba_retired_network_notice_dismissed:${retiredKey}`
}

/** The notice sentence for a retired network, or null if it is not retired. */
export function retiredNetworkMessage(retiredKey: string): string | null {
    const to = retiredNetworkSuccessor(retiredKey)
    if (!to) return null
    const from = NETWORKS[retiredKey]
    const successor = NETWORKS[to]
    const fromName = `${from.label} ${from.isTestnet ? "testnet" : "network"}`
    const toName = successor.isTestnet ? successor.label : `${successor.label} mainnet`
    return `The ${fromName} has been retired — you're now on ${toName}.`
}
