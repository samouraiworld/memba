/**
 * CreditSection — credit deposit/refund for pay-per-use agents.
 *
 * Extracted from Marketplace.tsx for maintainability.
 */

import { useState } from "react"
import { doContractBroadcast } from "../../lib/grc20"
import { MEMBA_DAO, AGENT_CREDITS_ENABLED } from "../../lib/config"

const REGISTRY_PATH = MEMBA_DAO.agentRegistryPath

export function CreditSection({ agentId, address, onError }: {
    agentId: string
    address: string
    onError: (msg: string) => void
}) {
    const [depositAmount, setDepositAmount] = useState("")
    const [submitting, setSubmitting] = useState(false)

    // A5.ui: fail-closed — disable credit operations when flag is off
    if (!AGENT_CREDITS_ENABLED) {
        return (
            <div className="mp-detail__section">
                <h3>Credits</h3>
                <div
                    role="alert"
                    style={{
                        padding: "12px 16px", borderRadius: 8, fontSize: 12,
                        background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.25)",
                        fontFamily: "JetBrains Mono, monospace", color: "var(--color-accent-gold)",
                        lineHeight: 1.6,
                    }}
                >
                    ⚠️ Agent credit deposits are temporarily disabled while the on-chain
                    registry is being verified. Do not send funds to agent contracts directly.
                </div>
            </div>
        )
    }

    const handleDeposit = async () => {
        const ugnot = Math.floor(parseFloat(depositAmount || "0") * 1_000_000)
        if (ugnot <= 0) return
        setSubmitting(true)
        try {
            const { buildDepositCreditsMsg } = await import("../../lib/agentTemplate")
            const msg = buildDepositCreditsMsg(address, REGISTRY_PATH, agentId, ugnot)
            await doContractBroadcast([msg], `Deposit ${depositAmount} GNOT credits`)
            setDepositAmount("")
        } catch (err) {
            onError(err instanceof Error ? err.message : "Deposit failed")
        } finally {
            setSubmitting(false)
        }
    }

    const handleRefund = async () => {
        setSubmitting(true)
        try {
            const { buildRefundCreditsMsg } = await import("../../lib/agentTemplate")
            const msg = buildRefundCreditsMsg(address, REGISTRY_PATH, agentId)
            await doContractBroadcast([msg], "Refund remaining credits")
        } catch (err) {
            onError(err instanceof Error ? err.message : "Refund failed")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="mp-detail__section">
            <h3>Credits</h3>
            <p className="mp-detail__hint">
                Deposit GNOT to use this agent. Credits are consumed per invocation.
            </p>
            <div className="mp-credit-actions">
                <div className="mp-credit-deposit">
                    <input
                        type="number"
                        min="0.001"
                        step="0.1"
                        placeholder="Amount (GNOT)"
                        value={depositAmount}
                        onChange={e => setDepositAmount(e.target.value)}
                        className="mp-credit-input"
                        disabled={submitting}
                    />
                    <button
                        className="mp-credit-btn mp-credit-btn--deposit"
                        onClick={handleDeposit}
                        disabled={submitting || !depositAmount}
                    >
                        {submitting ? "..." : "Deposit"}
                    </button>
                </div>
                <button
                    className="mp-credit-btn mp-credit-btn--refund"
                    onClick={handleRefund}
                    disabled={submitting}
                >
                    Refund All Credits
                </button>
            </div>
        </div>
    )
}
