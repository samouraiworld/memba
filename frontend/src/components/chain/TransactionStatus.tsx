/**
 * TransactionStatus — Displays the current state of a transaction.
 *
 * Shows a loading spinner during submission, success with explorer link
 * on confirmation, or error message on failure.
 *
 * @module components/chain/TransactionStatus
 */

import React from "react"
import { useChain } from "@/lib/chain"
import type { TxState } from "@/lib/chain/tx"
import { getExplorerName, formatTxHash } from "@/lib/chain/tx"

export interface TransactionStatusProps {
    state: TxState
    /** Label for the transaction type (e.g., "Vote", "Create Proposal"). */
    label?: string
    /** Callback when user dismisses the status. */
    onDismiss?: () => void
    className?: string
}

export function TransactionStatus({
    state,
    label = "Transaction",
    onDismiss,
    className = "",
}: TransactionStatusProps) {
    const { provider, family } = useChain()

    if (state.status === "idle") return null

    const explorerName = getExplorerName(family)

    const statusMap = {
        submitting: { icon: "⏳", text: `${label} submitting...`, cls: "tx-status--pending" },
        pending: { icon: "⏳", text: `${label} pending...`, cls: "tx-status--pending" },
        confirmed: { icon: "✅", text: `${label} confirmed`, cls: "tx-status--success" },
        failed: { icon: "❌", text: `${label} failed`, cls: "tx-status--error" },
    }

    const info = statusMap[state.status] ?? statusMap.pending

    return React.createElement("div", {
        className: `tx-status ${info.cls} ${className}`,
        role: "status",
        "aria-live": "polite",
    },
        React.createElement("span", { className: "tx-status__icon" }, info.icon),
        React.createElement("span", { className: "tx-status__text" }, info.text),

        // Explorer link on success
        state.result?.hash && React.createElement("a", {
            href: provider.getExplorerTxUrl(state.result.hash),
            target: "_blank",
            rel: "noopener noreferrer",
            className: "tx-status__link",
        }, `View on ${explorerName} (${formatTxHash(state.result.hash)})`),

        // Error message
        state.error && React.createElement("p", { className: "tx-status__error" }, state.error.message),

        // Gas used
        state.result?.gasUsed && React.createElement("span", {
            className: "tx-status__gas",
        }, `Gas: ${state.result.gasUsed.toLocaleString()}`),

        // Dismiss
        onDismiss && React.createElement("button", {
            className: "tx-status__dismiss",
            onClick: onDismiss,
            "aria-label": "Dismiss",
        }, "×"),
    )
}

/**
 * GasInfo — Conditional gas display.
 *
 * On EVM chains: hidden (gasless via Alchemy). User doesn't pay gas.
 * On Gno chains: shows estimated gas cost in GNOT.
 *
 * This component implements the S064 "Gas UI removal" requirement.
 */
export interface GasInfoProps {
    /** Estimated gas in native units (ugnot for Gno, wei for EVM). */
    estimatedGas?: bigint
    className?: string
}

export function GasInfo({ estimatedGas, className = "" }: GasInfoProps) {
    const { family, network } = useChain()

    // EVM path: no gas display (gasless via paymaster/sponsor)
    if (family === "evm") return null

    // Gno path: show gas estimate
    if (!estimatedGas) return null

    const gnot = Number(estimatedGas) / 1_000_000 // ugnot → GNOT
    return React.createElement("span", {
        className: `gas-info ${className}`,
        title: `${estimatedGas} ${network.nativeToken.microUnit}`,
    }, `~${gnot.toFixed(4)} ${network.nativeToken.symbol}`)
}
