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

import React, { useState, useCallback, useMemo, useEffect, type ReactNode } from "react"
import { ChainContext, type ChainContextValue } from "./context"
import { ChainError } from "./provider"
import type { ChainId, CALNetworkConfig } from "./types"
import { getProvider, getNetworkConfig, ALL_NETWORKS, registerProviderFactory } from "./registry"
import { createGnoProvider, type GnoProviderExtended } from "./gno/GnoProvider"
import { ACTIVE_NETWORK_KEY } from "../config"
import { chainIdToConfigKey, configKeyToChainId } from "./gnoBridge"
import { switchGnoNetwork } from "../networkSwitch"
import { useAdena } from "../../hooks/useAdena"

// ── Register factories (once) ────────────────────────────────

let factoriesRegistered = false
function ensureFactories() {
    if (factoriesRegistered) return
    registerProviderFactory("gno", createGnoProvider)
    // EVM is registered LAZILY: a static `createEvmProvider` import here would
    // drag viem into the eager entry graph for every user of the (Gno-only)
    // app. EVM networks are unreachable until B-5 Phase 4 — no selector shows
    // them and the active chain always resolves to a Gno network — so the
    // interim factory throwing is a can't-happen guard, not a user path. The
    // dynamic import swaps the real factory in as soon as the chunk loads;
    // getProvider never caches a provider from a throwing factory.
    // Bundle contract: viem lives in the lazy `vendor-evm` chunk, pinned by
    // scripts/check-evm-chunk.mjs.
    registerProviderFactory("evm", () => {
        throw new ChainError("EVM provider not loaded yet (activation is B-5 Phase 4)", "UNKNOWN", "evm")
    })
    void import("./evm/EvmProvider")
        .then((m) => registerProviderFactory("evm", m.createEvmProvider))
        .catch((err) => console.warn("[cal] EVM provider chunk failed to load (EVM stays unavailable):", err))
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

    // ── Wallet bridge (B-5 Phase 0/1) ────────────────────────
    // Push useAdena's wallet state into the GnoProvider so CAL writes carry
    // the connected address. Connection itself stays the hook's job; this is
    // one-way state sync, the Gno counterpart of wagmi → setWalletClient.
    // KNOWN GAP (recorded as a Phase-2 prerequisite in B5_CAL_MOUNT_PLAN):
    // useAdena instances are per-hook-instance and never cross-sync, so THIS
    // root instance misses interactive connects made through another instance
    // (until a visibilitychange retry) and never sees disconnects. Harmless
    // while the CAL has zero consumers; a shared wallet source must land
    // before any page uses CAL writes.
    const { connected: adenaConnected, address: adenaAddress } = useAdena()
    useEffect(() => {
        if (provider.family !== "gno") return
        const gno = provider as GnoProviderExtended
        gno.setWalletBridge(adenaConnected && adenaAddress ? { address: adenaAddress } : null)
        // Cleanup clears the OLD provider's bridge when the provider swaps
        // (EVM switch, Phase 4) so a registry-cached gno provider can't keep a
        // frozen address.
        return () => { gno.setWalletBridge(null) }
    }, [provider, adenaConnected, adenaAddress])

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
