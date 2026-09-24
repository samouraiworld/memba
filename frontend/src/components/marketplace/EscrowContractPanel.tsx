/**
 * EscrowContractPanel — look up an escrow contract by id and offer the two
 * clean-up calls escrow_v4 added:
 *
 *   - ArchiveContract (the client, once the contract is completed or
 *     cancelled): deletes it, and the chain refunds the freed storage deposit
 *     to the signer.
 *   - ExpireUnfunded (anyone, once a never-funded contract is past
 *     UnfundedExpiryBlks): cancels it and frees the client's slot.
 *
 * Both are refused while a pause's blocking window is open; the panel says
 * until which block. Like the hire dialog, nothing is broadcast unless the
 * services lane is live on this network (VITE_ENABLE_SERVICES && isEscrowValid()).
 */
import { useState, type FormEvent, type ReactNode } from "react"
import { MEMBA_DAO, isEscrowValid, isServicesEnabled } from "../../lib/config"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import { getCurrentBlock } from "../../lib/dao/proposalDates"
import { broadcastEscrowTx, planArchiveContract, planExpireUnfunded, type EscrowTxPlan } from "../../lib/marketplace/escrowTx"
import {
    archiveAvailability,
    archiveRefundEstimateUgnot,
    expireAvailability,
    formatApproxGnot,
    readEscrowContract,
    readEscrowPauseState,
    type EscrowAvailability,
    type EscrowContractView,
    type EscrowPauseState,
} from "../../lib/marketplace/escrowState"

export interface EscrowContractPanelProps {
    /** Connected wallet address, or "" when none. */
    caller: string
}

type Loaded = { id: string; contract: EscrowContractView | null; pause: EscrowPauseState; height: number }

const muted = { color: "var(--color-text-muted)", fontSize: "13px" }

function ActionRow({ testId, label, availability, busy, onRun, children }: {
    testId: string
    label: string
    availability: EscrowAvailability
    busy: boolean
    onRun: () => void
    children?: ReactNode
}) {
    return (
        <div data-testid={testId} style={{ marginTop: "12px" }}>
            <button className="k-btn k-btn--primary" onClick={onRun} disabled={busy || !availability.available}>
                {label}
            </button>
            {!availability.available && <p style={{ ...muted, margin: "6px 0 0" }}>{availability.reason}</p>}
            {availability.available && availability.note && <p style={{ ...muted, margin: "6px 0 0" }}>{availability.note}</p>}
            {children}
        </div>
    )
}

export function EscrowContractPanel({ caller }: EscrowContractPanelProps) {
    const [id, setId] = useState("")
    const [loaded, setLoaded] = useState<Loaded | null>(null)
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState<string | null>(null)

    const load = async (contractId: string) => {
        setLoading(true)
        setError(null)
        try {
            const [contract, pause, height] = await Promise.all([
                readEscrowContract(MEMBA_DAO.escrowPath, contractId),
                readEscrowPauseState(MEMBA_DAO.escrowPath),
                getCurrentBlock(),
            ])
            setLoaded({ id: contractId, contract, pause, height })
        } catch (err) {
            setLoaded(null)
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }

    const onLookup = (e: FormEvent) => {
        e.preventDefault()
        setDone(null)
        const trimmed = id.trim()
        if (!/^(0|[1-9]\d{0,8})$/.test(trimmed)) {
            setError("Enter a contract id: a whole number such as 0, 1 or 42.")
            return
        }
        void load(trimmed)
    }

    const run = async (plan: () => EscrowTxPlan, memo: string, success: string) => {
        if (!loaded) return
        // Same gate as the hire dialog: never broadcast while the lane is off here.
        if (!isServicesEnabled() || !isEscrowValid()) {
            setError("Service escrow is not available on this network yet.")
            return
        }
        setBusy(true)
        setError(null)
        try {
            await broadcastEscrowTx(plan(), memo)
            setDone(success)
            await load(loaded.id)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    const c = loaded?.contract ?? null
    const archive = c && loaded ? archiveAvailability(c, caller, loaded.pause, loaded.height) : null
    const expire = c && loaded ? expireAvailability(c, loaded.pause, loaded.height) : null
    const refund = c ? archiveRefundEstimateUgnot(c) : 0

    return (
        <section className="k-card" data-testid="escrow-contract-panel" style={{ marginTop: "24px", padding: "20px" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "16px", color: "var(--color-text)" }}>Your escrow contracts</h3>
            <p style={{ ...muted, margin: "0 0 12px" }}>
                Look up a contract to archive it once it is settled (the storage deposit comes back to the client),
                or to expire one that was never funded.
            </p>
            <form onSubmit={onLookup} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <label className="k-label" htmlFor="escrow-contract-id" style={{ alignSelf: "center" }}>Contract id</label>
                <input
                    id="escrow-contract-id"
                    className="k-input"
                    inputMode="numeric"
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    style={{ flex: "1 1 120px", minWidth: 0 }}
                />
                <button type="submit" className="k-btn k-btn--secondary" disabled={loading || busy}>
                    {loading ? "Loading..." : "Look up"}
                </button>
            </form>

            {error && <div className="k-error-banner" role="alert" style={{ marginTop: "12px" }}>{error}</div>}
            {done && <p role="status" style={{ ...muted, marginTop: "12px" }}>{done}</p>}

            {loaded && !c && (
                <p data-testid="escrow-contract-missing" style={{ ...muted, marginTop: "12px" }}>
                    {`Contract ${loaded.id} does not exist or has been archived.`}
                </p>
            )}

            {c && (
                <div data-testid="escrow-contract-details" style={{ marginTop: "16px" }}>
                    <strong style={{ color: "var(--color-text)" }}>{c.title}</strong>
                    <p style={{ ...muted, margin: "4px 0" }}>{`Contract ${c.id} · ${c.status} · created at block ${c.createdAt.toLocaleString("en-US")}`}</p>
                    <ul style={{ ...muted, margin: "4px 0 0", paddingLeft: "18px" }}>
                        {c.milestones.map((m, i) => (
                            <li key={i}>{`${m.title} — ${formatUgnotExact(m.amountUgnot)} [${m.status}]`}</li>
                        ))}
                    </ul>

                    {archive === null && (c.status === "completed" || c.status === "cancelled") && (
                        <p data-testid="escrow-archive-client-only" style={{ ...muted, marginTop: "12px" }}>
                            {caller ? "Only the client can archive this contract." : "Connect the client's wallet to archive this contract."}
                        </p>
                    )}

                    {archive && (
                        <ActionRow
                            testId="escrow-archive"
                            label={`Archive and reclaim deposit (${formatApproxGnot(refund)})`}
                            availability={archive}
                            busy={busy}
                            onRun={() => void run(() => planArchiveContract(caller, MEMBA_DAO.escrowPath, c.id), `Archive escrow ${c.id}`, `Contract ${c.id} archived. The chain refunds its storage deposit to you.`)}
                        >
                            <p style={{ ...muted, margin: "6px 0 0" }}>
                                Deletes the contract from the escrow realm. The chain refunds the freed storage deposit to the
                                signer, which is you, the client. The amount is an estimate. The contract&apos;s history stays in
                                its transaction events.
                            </p>
                        </ActionRow>
                    )}

                    {expire && (
                        <ActionRow
                            testId="escrow-expire"
                            label="Expire unfunded contract"
                            availability={expire}
                            busy={busy || !caller}
                            onRun={() => void run(() => planExpireUnfunded(caller, MEMBA_DAO.escrowPath, c.id), `Expire escrow ${c.id}`, `Contract ${c.id} expired. Its client can now archive it to reclaim the deposit.`)}
                        >
                            <p style={{ ...muted, margin: "6px 0 0" }}>
                                {caller ? "Anyone can cancel a contract that was never funded once it is old enough. No funds move; its client keeps the storage deposit to reclaim by archiving." : "Connect a wallet to expire this contract."}
                            </p>
                        </ActionRow>
                    )}
                </div>
            )}
        </section>
    )
}
