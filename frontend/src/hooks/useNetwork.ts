import { useState, useCallback } from "react"
import { useParams } from "react-router-dom"
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
 * Reads the network key from the /:network URL param (primary) or localStorage (fallback).
 * On switch, navigates to the new network URL and reloads to re-initialize RPC config.
 */
export function useNetwork() {
    const { network: urlNetwork } = useParams<{ network: string }>()
    const resolvedKey = (urlNetwork && NETWORKS[urlNetwork]) ? urlNetwork : getStoredNetwork()
    const [networkKey] = useState(resolvedKey)

    const network = NETWORKS[networkKey] || NETWORKS[DEFAULT_NETWORK]

    const switchNetwork = useCallback((key: string) => {
        if (!NETWORKS[key]) return
        localStorage.setItem(STORAGE_KEY, key)
        // Navigate to the same path but with the new network prefix
        const currentPath = window.location.pathname
        // Strip current network prefix if present
        const segments = currentPath.split("/").filter(Boolean)
        const firstSegment = segments[0]
        const restPath = (firstSegment && NETWORKS[firstSegment])
            ? "/" + segments.slice(1).join("/")
            : currentPath
        window.location.href = `/${key}${restPath || "/dashboard"}`
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
