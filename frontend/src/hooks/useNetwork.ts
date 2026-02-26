import { useState, useCallback } from "react"
import { NETWORKS, DEFAULT_NETWORK } from "../lib/config"

const STORAGE_KEY = "memba_network"

function getStoredNetwork(): string {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored && NETWORKS[stored]) return stored
    } catch { /* ignore */ }
    return DEFAULT_NETWORK
}

/**
 * Hook for managing the active Gno network.
 * Persists selection in localStorage and provides current chain config.
 */
export function useNetwork() {
    const [networkKey, setNetworkKey] = useState(getStoredNetwork)

    const network = NETWORKS[networkKey] || NETWORKS[DEFAULT_NETWORK]

    const switchNetwork = useCallback((key: string) => {
        if (!NETWORKS[key]) return
        localStorage.setItem(STORAGE_KEY, key)
        setNetworkKey(key)
        // Reload to re-initialize all hooks with new RPC endpoint
        window.location.reload()
    }, [])

    return {
        networkKey,
        chainId: network.chainId,
        rpcUrl: network.rpcUrl,
        label: network.label,
        switchNetwork,
        networks: NETWORKS,
    }
}
