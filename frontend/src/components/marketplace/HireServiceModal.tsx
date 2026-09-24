import { useEffect, useMemo, useState } from "react"
import { X } from "@phosphor-icons/react"
import { ACTIVE_NETWORK_KEY, MEMBA_DAO, isEscrowValid, isServicesEnabled } from "../../lib/config"
import { explorerHref } from "../../lib/explorerLink"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import { getCurrentBlock } from "../../lib/dao/proposalDates"
import { broadcastEscrowTx, escrowFailureMayHaveLanded, planHireService, type HirePlan } from "../../lib/marketplace/escrowTx"
import { findCreatedContract, hireAvailability, readClientActiveCount, readEscrowPauseState } from "../../lib/marketplace/escrowState"
import "../nft/TradeModal.css" // Reuse existing modal styles

export interface Service {
    id: string
    title: string
    freelancer: string
    description: string
    priceUgnot: number
    milestones: string
    category: string
    image: string
}

export interface HireServiceModalProps {
    service: Service
    /** Connected wallet address; it becomes the escrow client. */
    caller: string
    onClose: () => void
    /** Called once CreateContract landed, with the new contract's id when it could be read back (else null). */
    onSuccess: (contractId: string | null) => void
}

const muted = { color: "var(--color-text-muted)", fontSize: "14px" }

/** The realm's per-client cap and pause, read before offering to sign: "skip" when the lane is gated (nothing is sent then anyway). */
type Preflight = { state: "skip" } | { state: "loading" } | { state: "ok" } | { state: "blocked"; reason: string }

function useHirePreflight(caller: string): Preflight {
    const live = isServicesEnabled() && isEscrowValid()
    const [result, setResult] = useState<{ caller: string; preflight: Preflight } | null>(null)
    useEffect(() => {
        if (!live || !caller) return
        let cancelled = false
        Promise.all([readEscrowPauseState(MEMBA_DAO.escrowPath), readClientActiveCount(MEMBA_DAO.escrowPath, caller), getCurrentBlock()])
            .then(([pause, active, height]) => {
                const a = hireAvailability(pause, active, height)
                return a.available ? { state: "ok" as const } : { state: "blocked" as const, reason: a.reason }
            })
            .catch((err: unknown) => ({
                // Fail closed: without the pause state and the cap, the call may be refused after the fee is spent.
                state: "blocked" as const,
                reason: `Could not check the escrow contract's limits (${err instanceof Error ? err.message : String(err)}). Try again later.`,
            }))
            .then((preflight) => { if (!cancelled) setResult({ caller, preflight }) })
        return () => { cancelled = true }
    }, [live, caller])
    if (!live || !caller) return { state: "skip" }
    return result?.caller === caller ? result.preflight : { state: "loading" }
}
const rowStyle = { display: "flex", justifyContent: "space-between", marginBottom: "12px" }

export function HireServiceModal({ service, caller, onClose, onSuccess }: HireServiceModalProps) {
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Set after a failure that may have landed: CreateContract is not retried
    // plainly, because a second one makes a second contract and locks a second deposit.
    const [uncertain, setUncertain] = useState(false)
    const [confirmedNone, setConfirmedNone] = useState(false)

    // The preview and the signature come from this one plan: what is shown is what is signed.
    const prepared = useMemo((): { plan: HirePlan } | { problem: string } => {
        if (!caller) return { problem: "Connect your wallet to hire." }
        try {
            return { plan: planHireService(caller, MEMBA_DAO.escrowPath, service) }
        } catch (err) {
            return { problem: err instanceof Error ? err.message : String(err) }
        }
    }, [caller, service])
    const preflight = useHirePreflight(caller)
    const plan = "plan" in prepared ? prepared.plan : null
    const banner = error ?? ("problem" in prepared ? prepared.problem : null) ?? (preflight.state === "blocked" ? preflight.reason : null)
    const preflightHolds = preflight.state === "loading" || preflight.state === "blocked"

    const handleHire = async () => {
        // The services lane stays gated: the escrow realm must be listed for this network and
        // VITE_ENABLE_SERVICES on. Otherwise never broadcast; say so instead.
        if (!isServicesEnabled() || !isEscrowValid()) {
            setError("Service escrow is not available on this network yet.")
            return
        }
        if (!plan || preflightHolds || (uncertain && !confirmedNone)) return
        setError(null)
        setSubmitting(true)
        try {
            await broadcastEscrowTx(plan, `Create escrow: ${service.title}`)
        } catch (err) {
            if (escrowFailureMayHaveLanded(err)) {
                setUncertain(true)
                setConfirmedNone(false)
            }
            setError(err instanceof Error ? err.message : String(err))
            setSubmitting(false)
            return
        }
        // The contract landed. CreateContract's return value does not reach the wallet
        // reply, so read the client's newest contract back and check it is this one.
        let contractId: string | null = null
        try {
            contractId = await findCreatedContract(MEMBA_DAO.escrowPath, caller, {
                freelancer: service.freelancer,
                title: service.title,
                description: service.description,
                milestones: plan.milestones,
            })
        } catch {
            contractId = null
        }
        setSubmitting(false)
        onSuccess(contractId)
    }

    const contractsHref = explorerHref(ACTIVE_NETWORK_KEY, MEMBA_DAO.escrowPath)

    return (
        <div className="trade-modal-overlay">
            <div className="trade-modal">
                <div className="trade-modal-header">
                    <h2>Hire Freelancer</h2>
                    <button className="k-btn-icon" onClick={onClose} aria-label="Close" disabled={submitting}>
                        <X weight="bold" />
                    </button>
                </div>

                <div className="trade-modal-body">
                    <p className="k-text-muted" style={{ marginBottom: "24px", fontSize: "14px", lineHeight: 1.5 }}>
                        You are about to create an escrow contract with <strong>{service.freelancer}</strong>.
                        Nothing is sent now: you fund each milestone later with its exact amount, and it is
                        released to the freelancer only when you approve the work.
                    </p>

                    {banner && (
                        <div className="k-error-banner" role="alert" style={{ marginBottom: "16px" }}>
                            {banner}
                        </div>
                    )}

                    <div style={{ background: "var(--color-bg-tertiary)", padding: "16px", borderRadius: "12px", marginBottom: "24px" }}>
                        <div style={rowStyle}>
                            <span style={muted}>Service</span>
                            <strong style={{ color: "var(--color-text)", fontSize: "14px", textAlign: "right" }}>{service.title}</strong>
                        </div>
                        {plan && (
                            <>
                                <div style={rowStyle}>
                                    <span style={muted}>Milestones</span>
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                                        {plan.milestones.map((m, i) => (
                                            <div key={i} style={{ fontSize: "12px", color: "var(--color-text)", background: "var(--color-bg-secondary)", padding: "4px 8px", borderRadius: "4px" }}>
                                                {`${m.title} — ${formatUgnotExact(m.amountUgnot)}`}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div style={rowStyle}>
                                    <span style={muted}>Storage deposit cap</span>
                                    <span data-testid="hire-deposit-cap" style={{ color: "var(--color-text)", fontSize: "14px" }}>
                                        {formatUgnotExact(plan.maxDepositUgnot)}
                                    </span>
                                </div>
                                <p data-testid="hire-deposit-disclosure" style={{ ...muted, fontSize: "12px", margin: "0 0 12px" }}>
                                    {`The storage deposit (up to ${formatUgnotExact(plan.maxDepositUgnot)}; the chain locks only what the contract uses) is refunded to you when you archive the contract after it is completed or cancelled.`}
                                </p>
                                <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--color-border)", paddingTop: "12px", marginTop: "12px" }}>
                                    <span style={{ color: "var(--color-text)", fontWeight: 600 }}>Total to fund</span>
                                    <strong style={{ color: "var(--color-primary)", fontSize: "18px" }}>
                                        {formatUgnotExact(plan.totalUgnot)}
                                    </strong>
                                </div>
                            </>
                        )}
                    </div>

                    {preflight.state === "loading" && (
                        <p data-testid="hire-preflight-loading" style={{ ...muted, fontSize: "12px", margin: "0 0 12px" }}>
                            Checking the escrow contract&apos;s pause state and your open contracts...
                        </p>
                    )}

                    {uncertain && (
                        <div className="k-error-banner" style={{ marginBottom: "16px" }}>
                            <p style={{ margin: "0 0 8px" }}>
                                We could not confirm whether the contract was created. The transaction may be on
                                chain even though the wallet reported an error. Creating it again would make a second
                                contract and lock a second storage deposit.
                            </p>
                            {contractsHref && (
                                <p style={{ margin: "0 0 8px" }}>
                                    <a href={contractsHref} target="_blank" rel="noopener noreferrer">Check your escrow contracts</a>
                                    {" "}for one with this freelancer and title first.
                                </p>
                            )}
                            <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <input
                                    type="checkbox"
                                    checked={confirmedNone}
                                    onChange={(e) => setConfirmedNone(e.target.checked)}
                                    disabled={submitting}
                                />
                                I checked: no contract was created
                            </label>
                        </div>
                    )}

                    <div style={{ display: "flex", gap: "12px" }}>
                        <button
                            className="k-btn k-btn--secondary"
                            style={{ flex: 1, justifyContent: "center" }}
                            onClick={onClose}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            className="k-btn k-btn--primary"
                            style={{ flex: 1, justifyContent: "center" }}
                            onClick={handleHire}
                            disabled={submitting || !plan || preflightHolds || (uncertain && !confirmedNone)}
                        >
                            {submitting ? "Signing..." : uncertain ? "Create anyway" : "Sign Escrow Tx"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
