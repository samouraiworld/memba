/**
 * Chain Abstraction Layer (CAL) — React Context & Hook
 *
 * Provides the active ChainProvider to the React component tree via context.
 * UI components use `useChain()` to access chain operations without knowing
 * which chain family (Gno or EVM) is active.
 *
 * Usage:
 * ```tsx
 * // In a component:
 * const { provider, family, switchChain } = useChain()
 * const members = await provider.getDAOMembers(daoRef)
 * ```
 *
 * @module lib/chain/context
 */

import { createContext, useContext } from "react"
import type { ChainProvider } from "./provider"
import type { ChainFamily, ChainId, CALNetworkConfig } from "./types"
import { isCalEnabled } from "../config"

// ── Context Value ────────────────────────────────────────────

export interface ChainContextValue {
    /** The active chain provider (GnoProvider or EvmProvider). */
    provider: ChainProvider

    /** Which chain family is currently active. */
    family: ChainFamily

    /** Active network configuration. */
    network: CALNetworkConfig

    /**
     * Switch to a different chain/network.
     * This swaps the provider and updates all downstream consumers.
     */
    switchChain: (chainId: ChainId) => Promise<void>

    /** All available networks. */
    availableNetworks: CALNetworkConfig[]

    /** Whether the chain is currently loading/switching. */
    isLoading: boolean
}

// ── Context ──────────────────────────────────────────────────

/**
 * React context for the Chain Abstraction Layer.
 * Default value is null — must be wrapped in ChainContextProvider.
 */
export const ChainContext = createContext<ChainContextValue | null>(null)

// ── Hook ─────────────────────────────────────────────────────

/**
 * Access the active chain provider and utilities.
 *
 * @throws Error if used outside of ChainContextProvider
 *
 * @example
 * ```tsx
 * function ProposalList({ daoRef }: { daoRef: ContractRef }) {
 *   const { provider } = useChain()
 *   const [proposals, setProposals] = useState<CALProposal[]>([])
 *
 *   useEffect(() => {
 *     provider.getDAOProposals(daoRef).then(setProposals)
 *   }, [provider, daoRef])
 *
 *   return <ul>{proposals.map(p => <li key={p.id}>{p.title}</li>)}</ul>
 * }
 * ```
 */
export function useChain(): ChainContextValue {
    const ctx = useContext(ChainContext)
    if (!ctx) {
        throw new Error(
            "useChain() must be used within a <ChainContextProvider>. " +
            "Wrap your app root with the ChainContextProvider component."
        )
    }
    return ctx
}

/**
 * Flag-tolerant variant for the B-5 migration window: returns null when the
 * CAL is not mounted (VITE_ENABLE_CAL off — the prod default until Phase 3
 * completes) so a migrated call site can fall back to its direct-lib path.
 * The flag check comes FIRST and is build-time constant, so flag-off builds
 * fold this to `null` and the minifier drops the caller's CAL branch.
 *
 * This is THE access pattern for pages migrating under the flag — do not mix
 * it with bare useContext(ChainContext) at call sites.
 */
export function useChainOptional(): ChainContextValue | null {
    // Unconditional hook call (rules-of-hooks clean); the flag gates the
    // RESULT. Flag-off the provider isn't mounted anyway, so ctx is already
    // null — the explicit check makes the contract independent of mount state.
    const ctx = useContext(ChainContext)
    return isCalEnabled() ? ctx : null
}
