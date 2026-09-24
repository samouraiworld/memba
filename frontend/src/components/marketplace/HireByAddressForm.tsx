/**
 * HireByAddressForm — hire a freelancer you already know, by their address,
 * on milestones you write. It checks the draft exactly as escrow_v4's
 * CreateContract would (lib/marketplace/hireByAddress.ts, the realm-parity
 * builders), says what creating the contract commits, and hands the checked
 * listing to the hire dialog, which reads the pause state and the per-client
 * cap and signs.
 */
import { useMemo, useState, type FormEvent } from "react"
import { MEMBA_DAO } from "../../lib/config"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import { ESCROW_LIMITS } from "../../lib/marketplace/builders"
import { formatUgnotExactBig, planCreateContract, type HireableService } from "../../lib/marketplace/escrowTx"
import { checkHireDraft, type HireDraft, type HireDraftField } from "../../lib/marketplace/hireByAddress"
import "./escrow.css"

export interface HireByAddressFormProps {
    /** Connected wallet address (the client), or "" when none. */
    caller: string
    /** Why hiring is closed right now (pause, unreadable state), or null when open. */
    closedReason: string | null
    onReview: (service: HireableService, totalUgnot: bigint) => void
    onCancel: () => void
}

const EMPTY: HireDraft = { freelancer: "", title: "", description: "", milestones: [{ title: "", amountGnot: "" }] }

export function HireByAddressForm({ caller, closedReason, onReview, onCancel }: HireByAddressFormProps) {
    const [draft, setDraft] = useState<HireDraft>(EMPTY)
    const [problem, setProblem] = useState<{ field: HireDraftField | null; message: string } | null>(null)

    const check = useMemo(() => checkHireDraft(caller, MEMBA_DAO.escrowPath, draft), [caller, draft])
    // The deposit cap the dialog will show, once the draft is valid.
    const depositCap = useMemo(() => {
        if (!check.ok || !caller) return null
        try {
            return planCreateContract(caller, MEMBA_DAO.escrowPath, { ...check.service, milestones: check.milestones }).maxDepositUgnot
        } catch {
            return null
        }
    }, [check, caller])

    const set = (patch: Partial<HireDraft>) => { setProblem(null); setDraft((d) => ({ ...d, ...patch })) }
    const setMilestone = (i: number, patch: Partial<HireDraft["milestones"][number]>) =>
        set({ milestones: draft.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) })

    const onSubmit = (e: FormEvent) => {
        e.preventDefault()
        if (closedReason) return
        if (!check.ok) {
            setProblem({ field: check.field, message: check.message })
            return
        }
        onReview(check.service, check.totalUgnot)
    }

    const invalid = (field: HireDraftField) => (problem?.field === field ? true : undefined)
    const fieldError = (field: HireDraftField) =>
        problem?.field === field ? <p className="escrow-field-error" role="alert">{problem.message}</p> : null

    return (
        <form className="k-card" data-testid="hire-by-address" onSubmit={onSubmit} noValidate style={{ padding: "20px", marginBottom: "16px" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "16px", color: "var(--color-text)" }}>Hire by address</h3>
            <p className="escrow-muted" style={{ margin: "0 0 12px" }}>
                Hire someone you already work with. Agree on the milestones with them first: the contract cannot be edited once created.
            </p>

            <div className="escrow-field">
                <label className="k-label" htmlFor="hire-freelancer">Freelancer address</label>
                <input
                    id="hire-freelancer"
                    className="escrow-input escrow-input--mono"
                    value={draft.freelancer}
                    onChange={(e) => set({ freelancer: e.target.value })}
                    placeholder="g1..."
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={invalid("freelancer")}
                />
                {fieldError("freelancer")}
            </div>

            <div className="escrow-field">
                <label className="k-label" htmlFor="hire-title">Title</label>
                <input
                    id="hire-title"
                    className="escrow-input"
                    value={draft.title}
                    onChange={(e) => set({ title: e.target.value })}
                    maxLength={ESCROW_LIMITS.maxTitleBytes}
                    aria-invalid={invalid("title")}
                />
                {fieldError("title")}
            </div>

            <div className="escrow-field">
                <label className="k-label" htmlFor="hire-description">Description (optional)</label>
                <textarea
                    id="hire-description"
                    className="escrow-input"
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                    aria-invalid={invalid("description")}
                />
                {fieldError("description")}
            </div>

            <fieldset className="escrow-field" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
                <legend className="k-label" style={{ marginBottom: "6px" }}>Milestones</legend>
                {draft.milestones.map((m, i) => (
                    <div key={i} className="escrow-milestone-row">
                        <input
                            className="escrow-input"
                            aria-label={`Milestone ${i + 1} title`}
                            placeholder={`Milestone ${i + 1}`}
                            value={m.title}
                            onChange={(e) => setMilestone(i, { title: e.target.value })}
                            aria-invalid={invalid("milestones")}
                        />
                        <input
                            className="escrow-input"
                            aria-label={`Milestone ${i + 1} amount in GNOT`}
                            placeholder="GNOT"
                            inputMode="decimal"
                            value={m.amountGnot}
                            onChange={(e) => setMilestone(i, { amountGnot: e.target.value })}
                            aria-invalid={invalid("milestones")}
                        />
                        <button
                            type="button"
                            className="k-btn-secondary"
                            onClick={() => set({ milestones: draft.milestones.filter((_, j) => j !== i) })}
                            disabled={draft.milestones.length === 1}
                            aria-label={`Remove milestone ${i + 1}`}
                        >
                            Remove
                        </button>
                    </div>
                ))}
                {draft.milestones.length < ESCROW_LIMITS.maxMilestones && (
                    <button
                        type="button"
                        className="k-btn-secondary"
                        style={{ alignSelf: "flex-start" }}
                        onClick={() => set({ milestones: [...draft.milestones, { title: "", amountGnot: "" }] })}
                    >
                        Add milestone
                    </button>
                )}
                {fieldError("milestones")}
            </fieldset>

            <div className="escrow-notice" data-testid="hire-by-address-terms">
                <strong>Before you create the contract</strong>
                <ul>
                    <li>Nothing is paid when the contract is created. You fund each milestone later with its exact amount; it stays in escrow and goes to the freelancer only when you release it.</li>
                    <li>
                        {`Creating it locks a storage deposit${depositCap !== null ? ` (up to ${formatUgnotExact(depositCap)} for this contract; the chain locks only what it uses)` : ""}. It comes back to you when you archive the contract after it is completed or cancelled.`}
                    </li>
                    <li>Memba&apos;s service fee is taken from each milestone when it is released, at the rate the Memba DAO sets then (at most 5%). If you cancel, each funded milestone is refunded minus 5% paid to the freelancer.</li>
                    <li>{`One client can hold at most ${ESCROW_LIMITS.maxActivePerClient} open contracts; a contract stops counting once it is completed or cancelled.`}</li>
                    <li>The freelancer cannot find the contract on their own: after creating it, send them its link.</li>
                </ul>
            </div>

            {check.ok && (
                <p className="escrow-muted" data-testid="hire-by-address-total">{`Total to fund, one milestone at a time: ${formatUgnotExactBig(check.totalUgnot)}`}</p>
            )}
            {problem && problem.field === null && <div className="k-error-banner" role="alert">{problem.message}</div>}
            {closedReason && <div className="k-error-banner" role="alert">{closedReason}</div>}

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "12px" }}>
                <button type="button" className="k-btn-secondary" onClick={onCancel}>Cancel</button>
                <button type="submit" className="k-btn-primary" disabled={closedReason !== null}>Review and sign</button>
            </div>
        </form>
    )
}
