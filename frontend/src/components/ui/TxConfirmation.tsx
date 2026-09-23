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
import { callDepositCap, deployEffect } from "../../lib/parseMsgs"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"
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

// ── Argument display ─────────────────────────────────────────

/** Anything that looks like a bech32 address or a realm/package path, even glued to other text. */
const ADDRESS_OR_PATH = /g1[a-z0-9]{38}|gno\.land\/[pr]\//i
const FORMAT_CHARS = /\p{Cf}/gu

/** Arguments longer than this are cut behind a visible marker and a "Show full" toggle. */
const ARG_PREVIEW_CHARS = 64

/**
 * True when an argument must never be shortened: it is, or contains, an
 * address or a realm path. A signer tells lookalike addresses apart by any
 * character, including the middle ones a head…tail shortening would hide.
 */
function mustShowInFull(arg: string): boolean {
    // Invisible characters inside an address must not stop it being recognised.
    return ADDRESS_OR_PATH.test(arg.replace(FORMAT_CHARS, ""))
}

function CopyValueButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            type="button"
            className="tx-confirm-copy"
            aria-label={`Copy ${value}`}
            title={copied ? "Copied" : "Copy"}
            onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {})
            }}
        >
            {copied ? "Copied" : "Copy"}
        </button>
    )
}

/**
 * One call argument. Invisible formatting characters (zero-width, bidi
 * overrides) are shown as [U+XXXX] so they cannot reorder or hide what is
 * signed; Copy still copies the exact signed value.
 */
function TxArg({ value }: { value: string }) {
    const [expanded, setExpanded] = useState(false)
    const shown = revealInvisibleFormatting(value)
    if (mustShowInFull(value)) {
        return (
            <span className="tx-confirm-arg-wrap">
                <span className="tx-confirm-arg tx-confirm-arg--full">{shown}</span>
                <CopyValueButton value={value} />
            </span>
        )
    }
    const chars = Array.from(shown)
    if (chars.length <= ARG_PREVIEW_CHARS) {
        return <span className="tx-confirm-arg">{shown}</span>
    }
    const hidden = chars.length - ARG_PREVIEW_CHARS
    return (
        <span className="tx-confirm-arg-wrap">
            <span className="tx-confirm-arg tx-confirm-arg--full">{expanded ? shown : chars.slice(0, ARG_PREVIEW_CHARS).join("")}</span>
            {!expanded && <span className="tx-confirm-arg-marker">… {hidden.toLocaleString("en-US")} more characters hidden</span>}
            <button
                type="button"
                className="tx-confirm-copy"
                aria-expanded={expanded}
                aria-label={expanded ? "Show less" : "Show full argument"}
                onClick={() => setExpanded(v => !v)}
            >
                {expanded ? "Show less" : "Show full"}
            </button>
        </span>
    )
}

// ── Provider ─────────────────────────────────────────────────

export function TxConfirmationProvider({ children }: { children: React.ReactNode }) {
    const [request, setRequest] = useState<ConfirmationRequest | null>(null)
    const resolveRef = useRef<((v: boolean) => void) | null>(null)

    const requestConfirmation = useCallback((summary: TxSummary): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            resolveRef.current?.(false)
            resolveRef.current = resolve
            setRequest({ summary, resolve })
        })
    }, [])

    // A6: Register the confirmation callback so doContractBroadcast can invoke it
    useEffect(() => {
        setTxConfirmationCallback(async (msgs: AminoMsg[], memo: string) => {
            return requestConfirmation({ memo, messages: msgs })
        })
        return () => {
            setTxConfirmationCallback(null)
            resolveRef.current?.(false)
            resolveRef.current = null
        }
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
        const deploy = deployEffect(msg)
        const func = deploy ? `Deploy realm ${deploy.path}` : (v.func as string) || "unknown"
        const caller = (v.caller as string) || (v.creator as string) || ""
        const send = (v.send as string) || ""
        const args = (v.args as string[]) || []
        const pkgPath = deploy ? "" : (v.pkg_path as string) || ""
        const depositCap = deploy ? deploy.depositCap : callDepositCap(msg)

        return { index: i, func, caller, send, args, pkgPath, depositCap }
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
                    {revealInvisibleFormatting(memo)}
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
                                    <span className="tx-confirm-value tx-confirm-arg-wrap">
                                        <span className="tx-confirm-addr">{revealInvisibleFormatting(e.caller)}</span>
                                        <CopyValueButton value={e.caller} />
                                    </span>
                                </div>
                            )}
                            {e.depositCap && (
                                <div className="tx-confirm-detail-row">
                                    <span className="tx-confirm-label">Storage deposit cap</span>
                                    <span className="tx-confirm-value">{e.depositCap}</span>
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
                                        {e.pkgPath}
                                    </span>
                                </div>
                            )}
                            {e.args.length > 0 && (
                                <div className="tx-confirm-detail-row">
                                    <span className="tx-confirm-label">Args</span>
                                    <span className="tx-confirm-value tx-confirm-args">
                                        {e.args.map((a, i) => <TxArg key={i} value={String(a)} />)}
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
