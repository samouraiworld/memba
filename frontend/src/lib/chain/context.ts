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
