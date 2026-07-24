/**
 * TransactionFlow — Chain-agnostic transaction submission and tracking.
 *
 * Provides hooks and components for submitting transactions,
 * tracking confirmation status, and displaying results consistently
 * across Gno and EVM chains.
 *
 * @module lib/chain/tx
 */

import { useState, useCallback, useRef } from "react"
import type { TxResult, TxStatus } from "./types"
import type { ChainProvider } from "./provider"
import { ChainError } from "./provider"

// ── Transaction State ────────────────────────────────────────

export interface TxState {
    /** Current status. */
    status: TxStatus | "idle" | "submitting"
    /** Result after confirmation. */
    result: TxResult | null
    /** Error if failed. */
    error: ChainError | null
    /** Whether a tx is in progress. */
    isPending: boolean
}

const INITIAL_STATE: TxState = {
    status: "idle",
    result: null,
    error: null,
    isPending: false,
}

// ── Hook ─────────────────────────────────────────────────────

/**
 * Hook for submitting and tracking chain transactions.
 *
 * Usage:
 * ```tsx
 * const { submit, state, reset } = useTransaction()
 * const handleVote = () => submit(provider.vote(daoRef, proposalId, "yes"))
 * ```
 */
export function useTransaction() {
    const [state, setState] = useState<TxState>(INITIAL_STATE)
    const abortRef = useRef(false)

    const submit = useCallback(async (txPromise: Promise<TxResult>): Promise<TxResult | null> => {
        abortRef.current = false
        setState({ status: "submitting", result: null, error: null, isPending: true })

        try {
            const result = await txPromise
            if (abortRef.current) return null

            setState({
                status: result.success ? "confirmed" : "failed",
                result,
                error: result.success ? null : new ChainError(
                    result.error ?? "Transaction failed",
                    "CONTRACT_REVERT",
                    "evm",
                ),
                isPending: false,
            })
            return result
        } catch (err) {
            if (abortRef.current) return null

            const chainErr = err instanceof ChainError
                ? err
                : new ChainError(
                    err instanceof Error ? err.message : String(err),
                    "UNKNOWN",
                    "evm",
                    err,
                )

            setState({
                status: "failed",
                result: null,
                error: chainErr,
                isPending: false,
            })
            return null
        }
    }, [])

    const reset = useCallback(() => {
        abortRef.current = true
        setState(INITIAL_STATE)
    }, [])

    return { submit, state, reset }
}

// ── Toast notifications for tx lifecycle ─────────────────────

export type TxNotificationType = "submitting" | "confirmed" | "failed"

export interface TxNotification {
    id: string
    type: TxNotificationType
    message: string
    txHash?: string
    explorerUrl?: string
    timestamp: number
}

/**
 * Create a notification from a TxState change.
 */
export function createTxNotification(
    state: TxState,
    provider: ChainProvider,
    label = "Transaction",
): TxNotification | null {
    const id = `tx-${Date.now()}`
    const timestamp = Date.now()

    switch (state.status) {
        case "submitting":
            return { id, type: "submitting", message: `${label} submitting...`, timestamp }
        case "confirmed":
            return {
                id,
                type: "confirmed",
                message: `${label} confirmed!`,
                txHash: state.result?.hash,
                explorerUrl: state.result ? provider.getExplorerTxUrl(state.result.hash) : undefined,
                timestamp,
            }
        case "failed":
            return {
                id,
                type: "failed",
                message: `${label} failed: ${state.error?.message ?? "Unknown error"}`,
                timestamp,
            }
        default:
            return null
    }
}

// ── Explorer URL helpers ─────────────────────────────────────

/**
 * Get the appropriate block explorer name for the current chain.
 */
export function getExplorerName(family: "gno" | "evm"): string {
    return family === "gno" ? "GnoScan" : "Blockscout"
}

/**
 * Format a transaction hash for display.
 */
export function formatTxHash(hash: string, truncate = true): string {
    if (!truncate || hash.length <= 16) return hash
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`
}
