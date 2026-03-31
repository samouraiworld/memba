/**
 * NetworkSync — Synchronizes the /:network URL param with localStorage.
 *
 * When a user navigates to a URL with a different network (e.g., /betanet/dao/...)
 * this component detects the mismatch and triggers a reload to re-initialize
 * all RPC config that's computed at module load time.
 */
import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { NETWORKS } from "../../lib/config"

const STORAGE_KEY = "memba_network"

export function NetworkSync() {
    const { network } = useParams<{ network: string }>()

    useEffect(() => {
        if (!network || !NETWORKS[network]) return

        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored !== network) {
            localStorage.setItem(STORAGE_KEY, network)
            // Must reload — config.ts computes RPC URLs at module load time
            window.location.reload()
        }
    }, [network])

    return null
}
