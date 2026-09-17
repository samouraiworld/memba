/**
 * NetworkSync — keeps the URL echo (`memba_network`) in step with /:network, and
 * reloads when an IN-APP navigation lands on a different network.
 *
 * config.ts reads the network from the URL at module load, so a full page load
 * always initialises on the network it shows and never needs this reload. It
 * fires only when a <Link> or navigate() crosses networks inside the running
 * app, because RPC and realm config is computed once, at module load.
 *
 * The echo is not the user's choice — that lives in `memba_network_pref`,
 * written only by an explicit switch. See `resolveNetworkKey` in config.ts.
 */
import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { ACTIVE_NETWORK_KEY, NETWORKS } from "../../lib/config"

const STORAGE_KEY = "memba_network"

export function NetworkSync() {
    const { network } = useParams<{ network: string }>()

    useEffect(() => {
        if (!network || !NETWORKS[network]) return

        if (localStorage.getItem(STORAGE_KEY) !== network) {
            localStorage.setItem(STORAGE_KEY, network)
        }
        // Reload whenever the URL network differs from the network config.ts
        // actually initialized with (RPC URLs etc. are computed at module load
        // time) — regardless of what storage holds: another tab may already
        // have written this network to the echo key. A first visit on the
        // loaded network never reloads (no double-load for fresh visitors).
        if (network !== ACTIVE_NETWORK_KEY) {
            window.location.reload()
        }
    }, [network])

    return null
}
