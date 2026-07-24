import { useState, useCallback } from "react"
import { useParams } from "react-router-dom"
import { NETWORKS, DEFAULT_NETWORK } from "../lib/config"
import { switchGnoNetwork } from "../lib/networkSwitch"

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
 * Reads the network key from the /:network URL param (primary) or localStorage (fallback).
 * On switch, navigates to the new network URL and reloads to re-initialize RPC config.
 */
export function useNetwork() {
    const { network: urlNetwork } = useParams<{ network: string }>()
    const resolvedKey = (urlNetwork && NETWORKS[urlNetwork]) ? urlNetwork : getStoredNetwork()
    const [networkKey] = useState(resolvedKey)

    const network = NETWORKS[networkKey] || NETWORKS[DEFAULT_NETWORK]

    // The reload-on-switch contract lives in one place now (lib/networkSwitch), shared with
    // the Chain Abstraction Layer's switchChain so both behave identically.
    const switchNetwork = useCallback((key: string) => {
        switchGnoNetwork(key)
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
