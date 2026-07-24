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
import { ACTIVE_NETWORK_KEY } from "../config"
import { chainIdToConfigKey, configKeyToChainId } from "./gnoBridge"
import { switchGnoNetwork } from "../networkSwitch"

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
        // The CAL's active Gno chain follows config.ts's already-resolved active network
        // (which reads the shared `memba_network` key). config.ts is the single source of
        // truth — the CAL no longer keeps a separate `memba:activeChainId` (B-3).
        return configKeyToChainId(ACTIVE_NETWORK_KEY) ?? defaultChainId
    })
    const [isLoading, setIsLoading] = useState(false)

    const network = useMemo<CALNetworkConfig>(() => {
        const cfg = getNetworkConfig(activeChainId)
        if (!cfg) throw new Error(`Unknown chain: ${activeChainId}`)
        return cfg
    }, [activeChainId])

    const provider = useMemo(() => getProvider(network), [network])

    const switchChain = useCallback(async (chainId: ChainId) => {
        // Disconnect the current provider first, regardless of family.
        if (provider.isConnected()) {
            await provider.disconnect()
        }

        const key = chainIdToConfigKey(chainId)
        if (key) {
            // Gno: persist to `memba_network` and navigate, so config.ts re-runs and re-freezes
            // GNO_CHAIN_ID/GNO_RPC_URL to the new network. This is what keeps
            // `assertWalletBroadcastSafe` comparing the wallet against the correct chain after a
            // switch — an in-place swap (the old behaviour) left the frozen guard rejecting every
            // broadcast (B-3). The navigation unloads the page, so nothing below runs.
            switchGnoNetwork(key)
            return
        }

        // EVM: no config.ts entry, and the Gno broadcast guard does not apply to EVM. EVM chain
        // switching rides the (deferred) EVM/CAL activation, not the Gno reload — swap in place.
        setIsLoading(true)
        try {
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
