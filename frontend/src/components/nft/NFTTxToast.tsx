/**
 * NFTTxToast — Inline status toast for NFT transactions.
 * Shows "Submitted — waiting for confirmation" with optional tx hash link.
 * Auto-dismisses after 6s. Shows success or error state.
 */

import { useState, useEffect, useCallback } from "react"
import { getExplorerBaseUrl } from "../../lib/config"

type TxStatus = "pending" | "success" | "error"

export interface NFTTxState {
    status: TxStatus
    txHash?: string
    message?: string
}

interface Props {
    tx: NFTTxState | null
    onDismiss: () => void
}

export function NFTTxToast({ tx, onDismiss }: Props) {
    const [hiding, setHiding] = useState(false)

    const dismiss = useCallback(() => {
        setHiding(true)
        setTimeout(() => { setHiding(false); onDismiss() }, 300)
    }, [onDismiss])

    useEffect(() => {
        if (!tx || tx.status === "pending") return
        const t = setTimeout(dismiss, 6000)
        return () => clearTimeout(t)
    }, [tx, dismiss])

    if (!tx) return null

    const explorerBase = getExplorerBaseUrl()
    const txUrl = tx.txHash ? `${explorerBase}/tx/${tx.txHash}` : null

    const bg =
        tx.status === "pending" ? "rgba(0,212,170,0.1)" :
        tx.status === "success" ? "rgba(0,212,170,0.12)" :
        "rgba(239,68,68,0.1)"
    const color =
        tx.status === "error" ? "#ef4444" : "var(--color-primary)"

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                position: "fixed",
                top: "calc(var(--topbar-height, 56px) + 16px)",
                right: 16,
                zIndex: 1001,
                padding: "12px 18px",
                borderRadius: 10,
                background: bg,
                border: `1px solid ${color}`,
                color,
                fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
                maxWidth: 380,
                backdropFilter: "blur(4px)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                transition: "opacity 0.3s, transform 0.3s",
                opacity: hiding ? 0 : 1,
                transform: hiding ? "translateY(8px)" : "translateY(0)",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>
                    {tx.status === "pending" ? "⏳" : tx.status === "success" ? "✓" : "✕"}
                </span>
                <span style={{ fontWeight: 600 }}>
                    {tx.status === "pending"
                        ? "Submitted — waiting for confirmation"
                        : tx.status === "success"
                        ? (tx.message ?? "Transaction confirmed")
                        : (tx.message ?? "Transaction failed")}
                </span>
                {tx.status !== "pending" && (
                    <button
                        onClick={dismiss}
                        aria-label="Dismiss"
                        style={{ marginLeft: "auto", background: "none", border: "none", color, fontSize: 16, cursor: "pointer", padding: 0, opacity: 0.6 }}
                    >×</button>
                )}
            </div>
            {txUrl && (
                <a href={txUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 10, color, opacity: 0.75, textDecoration: "underline", fontFamily: "JetBrains Mono, monospace" }}>
                    View on explorer →
                </a>
            )}
        </div>
    )
}
