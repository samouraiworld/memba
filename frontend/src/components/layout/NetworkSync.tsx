/**
 * NetworkSync — Synchronizes the /:network URL param with localStorage.
 *
 * When a user navigates to a URL with a different network (e.g., /betanet/dao/...)
 * this component detects the mismatch and triggers a reload to re-initialize
 * all RPC config that's computed at module load time.
 */
import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { ACTIVE_NETWORK_KEY, NETWORKS } from "../../lib/config"

const STORAGE_KEY = "memba_network"

export function NetworkSync() {
    const { network } = useParams<{ network: string }>()

    useEffect(() => {
        if (!network || !NETWORKS[network]) return

        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored !== network) {
            localStorage.setItem(STORAGE_KEY, network)
            // Reload ONLY when the URL network differs from the network config.ts
            // actually initialized with (RPC URLs etc. are computed at module load
            // time). A first visit lands here with stored=null but the app ALREADY
            // loaded on the default network — reloading then is a pure double-load:
            // it cost every fresh visitor a full page reload, and in e2e it fired
            // mid-test on every fresh browser context (the firefox cmd-k flake and
            // the workers:2 first-attempt pass-rate regression).
            if (network !== ACTIVE_NETWORK_KEY) {
                window.location.reload()
            }
        }
    }, [network])

    return null
}
