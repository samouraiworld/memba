/**
 * Transaction Confirmation Modal — A6 (AAA-0)
 *
 * Shared confirmation dialog for all on-chain transactions.
 * Renders a summary of the transaction effects (recipients, amounts, fee,
 * message count) and blocks until the user explicitly confirms or cancels.
 *
 * Used by the TxConfirmationProvider context — doContractBroadcast calls
 * requestConfirmation() which returns a Promise<boolean>.
 *
 * Design: reuses the vote dialog pattern from ProposalView.tsx but
 * generalized for any transaction type.
 *
 * @module components/ui/TxConfirmation
 * @see docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md §5/A6
 */

import { useState, useCallback, useRef, useEffect } from "react"
import type { AminoMsg } from "../../lib/grc20"
import { setTxConfirmationCallback } from "../../lib/grc20"
import "./tx-confirmation.css"

// ── Types ────────────────────────────────────────────────────

export interface TxSummary {
    /** Human-readable memo/label for the transaction */
    memo: string
    /** Amino messages being broadcast */
    messages: AminoMsg[]
}

interface ConfirmationRequest {
    summary: TxSummary
    resolve: (confirmed: boolean) => void
}

// ── Provider ─────────────────────────────────────────────────

export function TxConfirmationProvider({ children }: { children: React.ReactNode }) {
    const [request, setRequest] = useState<ConfirmationRequest | null>(null)
    const resolveRef = useRef<((v: boolean) => void) | null>(null)

    const requestConfirmation = useCallback((summary: TxSummary): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            resolveRef.current = resolve
            setRequest({ summary, resolve })
        })
    }, [])

    // A6: Register the confirmation callback so doContractBroadcast can invoke it
    useEffect(() => {
        setTxConfirmationCallback(async (msgs: AminoMsg[], memo: string) => {
            return requestConfirmation({ memo, messages: msgs })
        })
        return () => setTxConfirmationCallback(null)
    }, [requestConfirmation])

    const handleConfirm = useCallback(() => {
        resolveRef.current?.(true)
        resolveRef.current = null
        setRequest(null)
    }, [])

    const handleCancel = useCallback(() => {
        resolveRef.current?.(false)
        resolveRef.current = null
        setRequest(null)
    }, [])

    return (
        <>
            {children}
            {request && (
                <TxConfirmationModal
                    summary={request.summary}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                />
            )}
        </>
    )
}

// ── Modal ────────────────────────────────────────────────────

function TxConfirmationModal({
    summary,
    onConfirm,
    onCancel,
}: {
    summary: TxSummary
    onConfirm: () => void
    onCancel: () => void
}) {
    const { messages, memo } = summary

    // Parse transaction effects from messages
    const effects = messages.map((msg, i) => {
        const v = msg.value as Record<string, unknown>
        const func = (v.func as string) || "unknown"
        const caller = (v.caller as string) || ""
        const send = (v.send as string) || ""
        const args = (v.args as string[]) || []
        const pkgPath = (v.pkg_path as string) || ""

        return { index: i, func, caller, send, args, pkgPath }
    })

    // Detect if any message involves sending funds
    const hasSend = effects.some(e => e.send && e.send !== "")

    // Close on Escape
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") onCancel()
    }, [onCancel])

    return (
        <div
            className="tx-confirm-overlay"
            onClick={onCancel}
            onKeyDown={handleKeyDown}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm transaction"
        >
            <div
                className="tx-confirm-modal"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="tx-confirm-header">
                    <h2>⚡ Confirm Transaction</h2>
                    <button
                        className="tx-confirm-close"
                        onClick={onCancel}
                        aria-label="Cancel"
                    >
                        ×
                    </button>
                </div>

                {/* Memo */}
                <div className="tx-confirm-memo">
                    {memo}
                </div>

                {/* Warning */}
                <div
                    className="tx-confirm-warning"
                    role="alert"
                >
                    ⚠️ This action will broadcast an on-chain transaction. It cannot be undone.
                </div>

                {/* Message summary */}
                <div className="tx-confirm-details">
                    <div className="tx-confirm-detail-row">
                        <span className="tx-confirm-label">Messages</span>
                        <span className="tx-confirm-value">{messages.length}</span>
                    </div>

                    {effects.map((e) => (
                        <div key={e.index} className="tx-confirm-msg">
                            <div className="tx-confirm-detail-row">
                                <span className="tx-confirm-label">Action</span>
                                <span className="tx-confirm-value tx-confirm-func">{e.func}</span>
                            </div>
                            {e.caller && (
                                <div className="tx-confirm-detail-row">
                                    <span className="tx-confirm-label">From</span>
                                    <span className="tx-confirm-value tx-confirm-addr">
                                        {e.caller.slice(0, 10)}...{e.caller.slice(-6)}
                                    </span>
                                </div>
                            )}
                            {e.send && (
                                <div className="tx-confirm-detail-row">
                                    <span className="tx-confirm-label">Send</span>
                                    <span className="tx-confirm-value tx-confirm-send">{e.send}</span>
                                </div>
                            )}
                            {e.pkgPath && (
                                <div className="tx-confirm-detail-row">
                                    <span className="tx-confirm-label">Contract</span>
                                    <span className="tx-confirm-value tx-confirm-path">
                                        {e.pkgPath.split("/").slice(-2).join("/")}
                                    </span>
                                </div>
                            )}
                            {e.args.length > 0 && (
                                <div className="tx-confirm-detail-row">
                                    <span className="tx-confirm-label">Args</span>
                                    <span className="tx-confirm-value tx-confirm-args">
                                        {e.args.map((a, i) => (
                                            <span key={i} className="tx-confirm-arg">
                                                {a.length > 20 ? a.slice(0, 10) + "..." + a.slice(-6) : a}
                                            </span>
                                        ))}
                                    </span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Fund warning for send transactions */}
                {hasSend && (
                    <div className="tx-confirm-fund-warning" role="alert">
                        💰 This transaction sends funds. Double-check the amount and recipient.
                    </div>
                )}

                {/* Actions */}
                <div className="tx-confirm-actions">
                    <button
                        id="tx-confirm-cancel-btn"
                        className="tx-confirm-btn tx-confirm-btn--cancel"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        id="tx-confirm-submit-btn"
                        className="tx-confirm-btn tx-confirm-btn--confirm"
                        onClick={onConfirm}
                        autoFocus
                    >
                        Confirm & Broadcast
                    </button>
                </div>
            </div>
        </div>
    )
}
