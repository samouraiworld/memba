/**
 * ChainContextProvider — React provider that manages chain switching.
 *
 * Wraps the app root. Reads active chain from URL/localStorage,
 * creates the correct provider (Gno or EVM), and exposes it via context.
 *
 * Usage:
 * ```tsx
 * <ChainContextProvider defaultChainId="topaz-1">
 *   <App />
 * </ChainContextProvider>
 * ```
 *
 * @module lib/chain/ChainContextProvider
 */

import React, { useState, useCallback, useMemo, type ReactNode } from "react"
import { ChainContext, type ChainContextValue } from "./context"
import type { ChainId, CALNetworkConfig } from "./types"
import { getProvider, getNetworkConfig, ALL_NETWORKS, registerProviderFactory } from "./registry"
import { createGnoProvider } from "./gno/GnoProvider"
import { createEvmProvider } from "./evm/EvmProvider"

// ── Storage key for persistence ──────────────────────────────

const CHAIN_STORAGE_KEY = "memba:activeChainId"

function getStoredChainId(): ChainId | null {
    if (typeof window === "undefined") return null
    return localStorage.getItem(CHAIN_STORAGE_KEY) as ChainId | null
}

function storeChainId(chainId: ChainId): void {
    if (typeof window === "undefined") return
    localStorage.setItem(CHAIN_STORAGE_KEY, chainId)
}

// ── Register factories (once) ────────────────────────────────

let factoriesRegistered = false
function ensureFactories() {
    if (factoriesRegistered) return
    registerProviderFactory("gno", createGnoProvider)
    registerProviderFactory("evm", createEvmProvider)
    factoriesRegistered = true
}

// ── Provider component ──────────────────────────────────────

export interface ChainContextProviderProps {
    /** Default chain if none stored. */
    defaultChainId?: ChainId
    children: ReactNode
}

export function ChainContextProvider({
    defaultChainId = "topaz-1",
    children,
}: ChainContextProviderProps) {
    ensureFactories()

    const [activeChainId, setActiveChainId] = useState<ChainId>(() => {
        return getStoredChainId() ?? defaultChainId
    })
    const [isLoading, setIsLoading] = useState(false)

    const network = useMemo<CALNetworkConfig>(() => {
        const cfg = getNetworkConfig(activeChainId)
        if (!cfg) throw new Error(`Unknown chain: ${activeChainId}`)
        return cfg
    }, [activeChainId])

    const provider = useMemo(() => getProvider(network), [network])

    const switchChain = useCallback(async (chainId: ChainId) => {
        setIsLoading(true)
        try {
            // Disconnect current provider
            if (provider.isConnected()) {
                await provider.disconnect()
            }
            storeChainId(chainId)
            setActiveChainId(chainId)
        } finally {
            setIsLoading(false)
        }
    }, [provider])

    const value = useMemo<ChainContextValue>(() => ({
        provider,
        family: network.family,
        network,
        switchChain,
        availableNetworks: ALL_NETWORKS,
        isLoading,
    }), [provider, network, switchChain, isLoading])

    return React.createElement(ChainContext.Provider, { value }, children)
}
