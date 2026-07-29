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

import React, { useState, useCallback, useMemo, useEffect, useSyncExternalStore, type ReactNode } from "react"
import { ChainContext, type ChainContextValue } from "./context"
import { ChainError } from "./provider"
import type { ChainId, CALNetworkConfig } from "./types"
import { getProvider, getNetworkConfig, ALL_NETWORKS, registerProviderFactory } from "./registry"
import { createGnoProvider, type GnoProviderExtended } from "./gno/GnoProvider"
import { ACTIVE_NETWORK_KEY } from "../config"
import { chainIdToConfigKey, configKeyToChainId } from "./gnoBridge"
import { switchGnoNetwork } from "../networkSwitch"
import { getWalletSnapshot, subscribe } from "../walletBus"

/**
 * Whether EVM networks may be offered to a user.
 *
 * **Currently false, and this is a security control, not a feature flag.** EVM
 * login is a blind `personal_sign` of a bare nonce — not SIWE — and no
 * `chainauth.Verifier` implementation exists, so the challenge carries no
 * expiry, single-use or chain binding (BACKLOG B-1/B-2 · AUTH-CHAINID-01).
 * Offering `rh-mainnet-4663` in a switcher before that closes would put
 * Robinhood **mainnet** in front of an unauthenticated signature path.
 *
 * A prior revision of the migration plan claimed `NetworkSelector` already
 * filtered `family === "evm"`. It did not — the provider passed `ALL_NETWORKS`
 * straight through, and a test pinned EVM networks as *present*. The only thing
 * preventing exposure was that the component happened to be imported nowhere.
 * This constant makes the guarantee real.
 *
 * Flip to `true` only when B-1/B-2 have landed and contracts are deployed.
 */
const EVM_NETWORKS_SELECTABLE = false

/** Networks a user may actually switch to. See {@link EVM_NETWORKS_SELECTABLE}. */
const SELECTABLE_NETWORKS = EVM_NETWORKS_SELECTABLE
    ? ALL_NETWORKS
    : ALL_NETWORKS.filter((n) => n.family !== "evm")

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
    // B-5 Phase 2a: wallet identity comes from the walletBus — the shared
    // source every useAdena instance publishes its transitions to — NOT from
    // an own useAdena instance (which could never see connects/disconnects
    // made through other instances, and duplicated the silent reconnect +
    // analytics event; the Phase-1 review's finding, closed here).
    const wallet = useSyncExternalStore(subscribe, getWalletSnapshot)
    useEffect(() => {
        if (provider.family !== "gno") return
        const gno = provider as GnoProviderExtended
        gno.setWalletBridge(wallet.connected && wallet.address ? { address: wallet.address } : null)
        // Cleanup clears the OLD provider's bridge when the provider swaps
        // (EVM switch, Phase 4) so a registry-cached gno provider can't keep a
        // frozen address.
        return () => { gno.setWalletBridge(null) }
    }, [provider, wallet])

    const switchChain = useCallback(async (chainId: ChainId) => {
        // EVM networks are not selectable yet. Enforced here as well as in
        // `availableNetworks` so a caller holding a raw ChainId (a deep link, a
        // restored localStorage value, a test) cannot route around the list.
        if (!EVM_NETWORKS_SELECTABLE && !chainIdToConfigKey(chainId)) {
            throw new ChainError(
                `EVM networks are not selectable until SIWE auth lands (BACKLOG B-1/B-2): ${chainId}`,
                "UNKNOWN",
                "evm",
            )
        }

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
        availableNetworks: SELECTABLE_NETWORKS,
        isLoading,
    }), [provider, network, switchChain, isLoading])

    return React.createElement(ChainContext.Provider, { value }, children)
}
