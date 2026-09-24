/**
 * EscrowContractDetail — one escrow_v4 contract as the realm reports it
 * (GetContractJSON), with the calls the connected address can make on it now.
 *
 * Which calls are listed, and when they are enabled, follows the realm's
 * guards (lib/marketplace/escrowActions.ts): role and state decide what is
 * listed; the pause, the realm's pause-adjusted deadlines and a missing wallet
 * disable an action and say why. Each call is planned from the contract as
 * read (FundMilestone sends exactly the stored amount), goes through the
 * shared confirmation dialog (TxConfirmation) and broadcastEscrowTx (budget,
 * realm and lane re-checks), and is never re-sent automatically. After it
 * lands the contract is read again. When the outcome is unknown, every action
 * stays disabled until the contract is read again, so a user checks the
 * contract before retrying.
 *
 * Text stored on chain (title, description, milestone titles, addresses) is
 * shown with the signing components, so invisible characters are revealed.
 */
import { useCallback, useEffect, useState } from "react"
import { MEMBA_DAO, isEscrowValid, isServicesEnabled } from "../../lib/config"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import { getCurrentBlock } from "../../lib/dao/proposalDates"
import { broadcastEscrowTx, escrowFailureMayHaveLanded } from "../../lib/marketplace/escrowTx"
import {
    archiveRefundEstimateUgnot,
    exitsClosedReason,
    formatApproxGnot,
    formatBlocksEta,
    readEscrowContract,
    readEscrowPauseState,
    type EscrowContractView,
    type EscrowMilestoneStatus,
    type EscrowPauseState,
} from "../../lib/marketplace/escrowState"
import {
    escrowActionDone,
    escrowActionEffect,
    escrowActionLabel,
    escrowActionMemo,
    escrowActions,
    escrowRole,
    planEscrowAction,
    type EscrowAction,
} from "../../lib/marketplace/escrowActions"
import { CopyValueButton, SignedAddress, SignedText } from "../ui/SigningValue"
import "./escrow.css"

export interface EscrowContractDetailProps {
    id: string
    /** Connected wallet address, or "" when none. */
    caller: string
    /** Called after a call landed, e.g. to refresh a list of contracts. */
    onChanged?: () => void
    /** Absolute URL of this contract's page, for the share box. */
    shareUrl?: string
    /** The contract was just created by the connected client: ask them to share the link. */
    justCreated?: boolean
}

type Loaded = { contract: EscrowContractView | null; pause: EscrowPauseState; height: number }

const STATUS_LABEL: Record<EscrowMilestoneStatus, string> = {
    pending: "Not funded",
    funded: "Funded, in escrow",
    completed: "Delivered, awaiting release",
    released: "Released to the freelancer",
    disputed: "In dispute",
    refunded: "Refunded to the client",
}

const NOT_LIVE = "Service escrow is not available on this network yet."

const actionKey = (a: EscrowAction) => `${a.kind}-${a.milestone ?? "contract"}`

const block = (h: number) => `block ${h.toLocaleString("en-US")}`

function testIdOf(a: EscrowAction): string {
    if (a.kind === "archive") return "escrow-archive"
    if (a.kind === "expire") return "escrow-expire"
    return a.milestone === null ? `escrow-${a.kind}` : `escrow-${a.kind}-${a.milestone}`
}

function ActionRow({ action, label, busy, onRun }: { action: EscrowAction; label: string; busy: boolean; onRun: () => void }) {
    const a = action.availability
    const primary = action.kind === "fund" || action.kind === "release" || action.kind === "complete" || action.kind === "archive"
    return (
        <div className="escrow-action" data-testid={testIdOf(action)}>
            <button className={primary ? "k-btn-primary" : "k-btn-secondary"} onClick={onRun} disabled={busy || !a.available}>
                {label}
            </button>
            {!a.available && <p className="escrow-muted">{a.reason}</p>}
            <p className="escrow-muted">{escrowActionEffect(action)}</p>
        </div>
    )
}

/** A contract page link with a Copy button. */
export function EscrowShareLink({ url, lead }: { url: string; lead: string }) {
    return (
        <div data-testid="escrow-share" style={{ margin: "12px 0" }}>
            <p className="escrow-muted" style={{ margin: "0 0 6px" }}>{lead}</p>
            <div className="escrow-share">
                <input className="escrow-input escrow-input--mono" readOnly value={url} aria-label="Contract link" onFocus={(e) => e.currentTarget.select()} />
                <CopyValueButton value={url} />
            </div>
        </div>
    )
}

export function EscrowContractDetail({ id, caller, onChanged, shareUrl, justCreated }: EscrowContractDetailProps) {
    const live = isServicesEnabled() && isEscrowValid()
    const [loaded, setLoaded] = useState<Loaded | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState<string | null>(null)
    // Set when a broadcast failed in a way that may still have landed: no call is
    // offered again until the contract has been read back.
    const [uncertain, setUncertain] = useState(false)
    // The call that just landed: held back until a manual reload, in case the node
    // answered the re-read before it applied the block (a repeat would only cost a fee).
    const [sent, setSent] = useState<string | null>(null)

    /** One read of the contract, the pause state and the height. No reads unless the lane is live here: elsewhere the realm may not exist. */
    const read = useCallback(async (): Promise<Loaded> => {
        if (!live) throw new Error(NOT_LIVE)
        const [contract, pause, height] = await Promise.all([
            readEscrowContract(MEMBA_DAO.escrowPath, id),
            readEscrowPauseState(MEMBA_DAO.escrowPath),
            getCurrentBlock(),
        ])
        return { contract, pause, height }
    }, [live, id])

    const settle = useCallback((result: { ok: true; value: Loaded } | { ok: false; error: unknown }): boolean => {
        setLoading(false)
        if (result.ok) {
            setLoaded(result.value)
            return true
        }
        // Fail closed: nothing is offered from a contract that could not be read.
        setLoaded(null)
        setError(result.error instanceof Error ? result.error.message : String(result.error))
        return false
    }, [])

    const load = useCallback(async (): Promise<boolean> => {
        setLoading(true)
        try {
            return settle({ ok: true, value: await read() })
        } catch (err) {
            return settle({ ok: false, error: err })
        }
    }, [read, settle])

    useEffect(() => {
        let cancelled = false
        read().then(
            (value) => { if (!cancelled) settle({ ok: true, value }) },
            (error: unknown) => { if (!cancelled) settle({ ok: false, error }) },
        )
        return () => { cancelled = true }
    }, [read, settle])

    const reload = async () => {
        setError(null)
        setDone(null)
        setSent(null)
        if (await load()) setUncertain(false)
    }

    const run = async (action: EscrowAction, c: EscrowContractView) => {
        // Same gate as the hire dialog: never broadcast while the lane is off here.
        if (!isServicesEnabled() || !isEscrowValid()) {
            setError(NOT_LIVE)
            return
        }
        if (uncertain || busy) return
        setBusy(true)
        setError(null)
        setDone(null)
        try {
            const plan = planEscrowAction(action, c, caller, MEMBA_DAO.escrowPath)
            await broadcastEscrowTx(plan, escrowActionMemo(action, c.id))
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            if (escrowFailureMayHaveLanded(err)) {
                setUncertain(true)
                setError(`${message} The transaction may still have reached the chain. Check the contract before retrying: reload it and see whether its state changed.`)
            } else {
                setError(message)
            }
            setBusy(false)
            return
        }
        setDone(escrowActionDone(action, c.id))
        setSent(actionKey(action))
        await load()
        setBusy(false)
        onChanged?.()
    }

    const c = loaded?.contract ?? null
    const role = c ? escrowRole(c, caller) : "other"
    const actions = (c && loaded ? escrowActions(c, caller, loaded.pause, loaded.height) : []).map((a): EscrowAction =>
        a.availability.available && actionKey(a) === sent
            ? { ...a, availability: { available: false, reason: "Sent a moment ago. Reload once the chain shows the change before trying again." } }
            : a)
    const contractActions = actions.filter((a) => a.milestone === null)
    // Right after creation, until the first milestone is funded: ask the client to share the link.
    const showCreated = Boolean(justCreated && shareUrl && c && role === "client" && c.status === "active" && c.milestones.every((m) => m.status === "pending"))
    const label = (a: EscrowAction) => (a.kind === "archive" && c ? `${escrowActionLabel(a)} (${formatApproxGnot(archiveRefundEstimateUgnot(c))})` : escrowActionLabel(a))
    const row = (a: EscrowAction) => (
        <ActionRow key={actionKey(a)} action={a} label={label(a)} busy={busy || loading || uncertain} onRun={() => { if (c) void run(a, c) }} />
    )
    const pauseNote = loaded?.pause.paused
        ? exitsClosedReason(loaded.pause, loaded.height) ?? "Escrow is paused: new contracts and funding are refused until it is unpaused. Every other action is open."
        : null

    return (
        <div data-testid="escrow-contract-detail">
            {error && <div className="k-error-banner" role="alert" style={{ marginTop: "12px" }}>{error}</div>}
            {uncertain && (
                <button className="k-btn-secondary" style={{ marginTop: "8px" }} onClick={() => void reload()} disabled={loading}>
                    {loading ? "Reloading..." : "Reload contract"}
                </button>
            )}
            {done && <p role="status" className="escrow-muted" style={{ marginTop: "12px" }}>{done}</p>}
            {loading && !loaded && <p className="escrow-muted" style={{ marginTop: "12px" }}>{`Loading contract ${id}...`}</p>}

            {loaded && !c && (
                <p data-testid="escrow-contract-missing" className="escrow-muted" style={{ marginTop: "12px" }}>
                    {`Contract ${id} does not exist or has been archived.`}
                </p>
            )}

            {c && loaded && (
                <div data-testid="escrow-contract-details" style={{ marginTop: "16px" }}>
                    {showCreated && shareUrl && (
                        <div className="escrow-notice" data-testid="escrow-created">
                            <strong>{`Contract ${c.id} is created.`}</strong> Nothing is in escrow yet: fund the first milestone
                            below when you are ready. Your freelancer cannot find this contract on their own, so send them its link.
                            <EscrowShareLink url={shareUrl} lead="Share this link with your freelancer:" />
                        </div>
                    )}

                    <h3 style={{ margin: "0 0 4px", fontSize: "18px", color: "var(--color-text)" }}>
                        <SignedText value={c.title} />
                    </h3>
                    <p className="escrow-muted" style={{ margin: "0 0 8px" }}>
                        {`Contract ${c.id} · ${c.status} · created at ${block(c.createdAt)}`}
                    </p>
                    {c.description && (
                        <p style={{ margin: "0 0 8px", color: "var(--color-text)", fontSize: "14px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                            <SignedText value={c.description} />
                        </p>
                    )}

                    <dl className="escrow-grid">
                        <dt>Client{role === "client" ? " (you)" : ""}</dt>
                        <dd><SignedAddress value={c.client} /></dd>
                        <dt>Freelancer{role === "freelancer" ? " (you)" : ""}</dt>
                        <dd><SignedAddress value={c.freelancer} /></dd>
                        <dt>Total</dt>
                        <dd data-testid="escrow-total">{formatUgnotExact(c.totals.amountUgnot)}</dd>
                        <dt>In escrow</dt>
                        <dd data-testid="escrow-escrowed">{formatUgnotExact(c.totals.escrowedUgnot)}</dd>
                        <dt>Released</dt>
                        <dd>{formatUgnotExact(c.totals.releasedUgnot)}</dd>
                        <dt>Refunded</dt>
                        <dd>{formatUgnotExact(c.totals.refundedUgnot)}</dd>
                        <dt>Fees</dt>
                        <dd data-testid="escrow-fee-terms">
                            Memba&apos;s service fee is taken from each milestone when it is paid out, at the rate the Memba DAO
                            sets at that moment (at most 5%). If the client cancels, each funded milestone is refunded minus 5%
                            paid to the freelancer.
                        </dd>
                    </dl>

                    {pauseNote && <div className="escrow-notice" role="status" data-testid="escrow-pause-note">{pauseNote}</div>}

                    {role === "other" && (
                        <p className="escrow-muted" data-testid="escrow-role-note">
                            {caller
                                ? "You are not a party to this contract. You can only make the calls anyone can make once a deadline has passed."
                                : "Connect the client's or the freelancer's wallet to act on this contract."}
                        </p>
                    )}

                    <h4 style={{ margin: "16px 0 0", fontSize: "14px", color: "var(--color-text)" }}>Milestones</h4>
                    <ol className="escrow-milestones">
                        {c.milestones.map((m) => {
                            const heights = [
                                m.fundedAt !== null ? `funded at ${block(m.fundedAt)}` : null,
                                m.completedAt !== null ? `delivered at ${block(m.completedAt)}` : null,
                                m.disputedAt !== null ? `disputed at ${block(m.disputedAt)}` : null,
                                m.refundAt !== null ? `refundable by anyone from ${block(m.refundAt)}${loaded.height > 0 && m.refundAt > loaded.height ? ` (${formatBlocksEta(m.refundAt - loaded.height)})` : ""}` : null,
                                m.resolveAt !== null ? `settleable by anyone from ${block(m.resolveAt)}${loaded.height > 0 && m.resolveAt > loaded.height ? ` (${formatBlocksEta(m.resolveAt - loaded.height)})` : ""}` : null,
                            ].filter((s): s is string => s !== null)
                            return (
                                <li key={m.index} className="escrow-milestone" data-testid={`escrow-milestone-${m.index}`}>
                                    <div className="escrow-milestone-head">
                                        <span>
                                            {`${m.index + 1}. `}<SignedText value={m.title} />{` — ${formatUgnotExact(m.amountUgnot)}`}
                                        </span>
                                        <span className="escrow-status">{STATUS_LABEL[m.status]}</span>
                                    </div>
                                    {heights.length > 0 && <p className="escrow-muted" style={{ margin: "4px 0 0" }}>{heights.join(" · ")}</p>}
                                    {actions.filter((a) => a.milestone === m.index).map(row)}
                                </li>
                            )
                        })}
                    </ol>

                    {contractActions.length > 0 && (
                        <div style={{ marginTop: "16px" }}>
                            <h4 style={{ margin: 0, fontSize: "14px", color: "var(--color-text)" }}>Contract</h4>
                            {contractActions.map(row)}
                        </div>
                    )}

                    {role !== "client" && (c.status === "completed" || c.status === "cancelled") && (
                        <p data-testid="escrow-archive-client-only" className="escrow-muted" style={{ marginTop: "12px" }}>
                            {caller ? "Only the client can archive this contract." : "Connect the client's wallet to archive this contract."}
                        </p>
                    )}

                    {shareUrl && !showCreated && <EscrowShareLink url={shareUrl} lead="Link to this contract:" />}

                    <button className="k-btn-secondary" style={{ marginTop: "12px" }} onClick={() => void reload()} disabled={loading || busy}>
                        {loading ? "Reloading..." : "Reload"}
                    </button>
                </div>
            )}
        </div>
    )
}
