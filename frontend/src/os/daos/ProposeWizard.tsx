/**
 * The New proposal wizard (mockup v4 FLOWS.prop): Type → Details → Review,
 * with a live "Members will see" preview and an automatic draft. Signing goes
 * through the Memba review sheet (proposeRequest). Version-2 DAOs only.
 *
 * @module os/daos/ProposeWizard
 */
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { clearGovernanceReceipt, clearProposalDraft, readGovernanceReceipt, readProposalDraft, saveProposalDraft, type ProposalDraft } from "../../lib/dao/governanceRecovery"
import type { DaoProposalKind } from "../../lib/dao/kind"
import { formatDuration } from "../../lib/templates/dao/v2/duration"
import { v2CharCount, V2_MAX_DESCRIPTION_CHARS, V2_MAX_TITLE_CHARS } from "../../lib/dao/v2Text"
import { useDaoKind } from "../../hooks/useDaoKind"
import { ThingTile } from "../shell/icons"
import type { OsSession } from "../shell/useOsSession"
import { specForTarget, type WindowSpec } from "../shell/windows"
import { useSigner } from "../sign/signerContext"
import { Field, WizardFrame } from "../wizard/WizardFrame"
import { realmForName } from "./daoNames"
import { emptyDraft, evaluateProposal, needsRoles, needsTarget, proposalEffect, TYPE_HINTS, TYPE_LABELS, type Field as FieldName } from "./proposal"
import { proposalDraftScope, proposalScope, proposeRequest } from "./proposeRequest"
import { useDaoConfig, useDaoMembers } from "./useOsDao"

const STEPS = ["Type", "Details", "Review"] as const
const TARGET_TYPES = [
    { name: "Spend from treasury", what: "Pay GNOT or tokens from the DAO.", tag: "Target · contract v3" },
    { name: "Update shared desk", what: "Change the DAO’s shared desktop.", tag: "Target · v1.1" },
] as const

function Gate({ children }: { children: ReactNode }) {
    return <div className="os-holding"><ThingTile icon="doc" size={44} /><div className="os-stack os-tight">{children}</div></div>
}

export function ProposeWizard({ dao, session, open, close }: { dao: string; session: OsSession; open: (spec: WindowSpec) => void; close: () => void }) {
    const realmPath = realmForName(dao)
    if (!realmPath) return <Gate><b>“{dao}” isn't a DAO address.</b></Gate>
    if (session.status !== "member") {
        return <Gate><b>Connect a wallet to make a proposal.</b><button type="button" className="os-btn" onClick={session.openConnect}>Connect</button></Gate>
    }
    // Keyed by wallet: a draft and a lock belong to one member.
    return <Wizard key={`${realmPath}:${session.address}`} dao={dao} realmPath={realmPath} session={session} open={open} close={close} />
}

function Wizard({ dao, realmPath, session, open, close }: { dao: string; realmPath: string; session: OsSession; open: (spec: WindowSpec) => void; close: () => void }) {
    const caller = session.address
    const signer = useSigner()
    const kind = useDaoKind(realmPath)
    const config = useDaoConfig(realmPath)
    const members = useDaoMembers(realmPath, undefined)
    const draftScope = useMemo(() => proposalDraftScope(realmPath, caller), [realmPath, caller])
    const [draft, setDraft] = useState<ProposalDraft>(() => readProposalDraft(draftScope) ?? emptyDraft("text"))
    const [step, setStep] = useState(0)
    const [showErrors, setShowErrors] = useState(false)
    const [checked, setChecked] = useState(false)
    const [, rerender] = useState(0)

    // The automatic draft (D18), in the classic draft slot so either interface can continue it.
    useEffect(() => {
        try { saveProposalDraft(draftScope, draft) } catch { /* storage refused: the draft lasts for this visit */ }
    }, [draftScope, draft])

    if (kind.loading || config.isPending || members.isPending) return <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Loading the DAO's settings…</span></div>
    const v2 = config.data?.v2
    if (kind.kind !== "memba-v2" || !v2) {
        return <Gate><b>Memba OS makes proposals for version-2 DAOs.</b><span className="os-sub">This DAO uses another contract. Its proposals are listed in its folder.</span></Gate>
    }
    if (!members.data) return <Gate><b>The DAO's members couldn't be read.</b><button type="button" className="os-btn os-quiet" onClick={() => void members.refetch()}>Try again</button></Gate>
    if (v2.archived) return <Gate><b>{v2.name} is archived.</b><span className="os-sub">It no longer accepts proposals.</span></Gate>
    if (!members.data.some((m) => m.address === caller)) return <Gate><b>Only members of {v2.name} can make proposals.</b><span className="os-sub">Your connected wallet isn't a member.</span></Gate>

    const receipt = readGovernanceReceipt(proposalScope(realmPath, caller))
    if (receipt) {
        const created = receipt.phase === "confirmed" && receipt.proposalId
        return (
            <Gate>
                <b>{created ? `Proposal #${receipt.proposalId} was created.` : "Outcome unknown."}</b>
                <span className="os-sub">{created ? "Start another one when you're ready." : "A previous proposal attempt is saved. Check its outcome before submitting again."}</span>
                {receipt.hash && <code className="os-mono os-break">Transaction {receipt.hash}</code>}
                {created && <button type="button" className="os-btn os-ghost" onClick={() => open(specForTarget({ kind: "proposal", dao, n: receipt.proposalId! })!)}>Open proposal #{receipt.proposalId}</button>}
                {!created && <label className="os-ack"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the transaction and want to review a proposal again.</label>}
                <button type="button" className="os-btn os-quiet" disabled={!created && !checked} onClick={() => {
                    try { clearGovernanceReceipt(proposalScope(realmPath, caller)); setChecked(false); rerender((x) => x + 1) } catch { /* a request is still in flight */ }
                }}>{created ? "Start a new proposal" : "Review a proposal again"}</button>
            </Gate>
        )
    }

    const kinds = kind.capabilities.propose
    const e = evaluateProposal(draft, v2, members.data)
    const set = (patch: Partial<ProposalDraft>) => setDraft((d) => ({ ...d, ...patch }))
    const shown = (f: FieldName, value: string) => ((showErrors || value !== "") ? e.problems[f] : undefined)
    const detailsValid = !!e.action

    const next = () => {
        if (step === 1 && !detailsValid) { setShowErrors(true); return }
        if (step < STEPS.length - 1) { setStep(step + 1); return }
        if (!e.action) return
        signer.sign(proposeRequest({
            daoKind: "memba-v2", realmPath, daoName: v2.name, caller, config: v2, proposalKind: draft.kind, action: e.action,
            effect: proposalEffect(draft, e, v2.name),
            onCreated: (id) => {
                try { clearProposalDraft(draftScope) } catch { /* nothing to clear */ }
                close()
                open(specForTarget({ kind: "proposal", dao, n: id })!)
            },
        }))
    }

    let body
    if (step === 0) {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h">What should this proposal do?</h3>
                <div className="os-opt" role="radiogroup" aria-label="Proposal type">
                    {kinds.map((k: DaoProposalKind) => (
                        <button key={k} type="button" role="radio" aria-checked={draft.kind === k} className={k === "archive" ? "os-danger" : undefined}
                            onClick={() => set({ kind: k, roles: null })}>
                            <b>{TYPE_LABELS[k]}</b><span className="os-sub">{TYPE_HINTS[k]}</span>
                        </button>
                    ))}
                    {TARGET_TYPES.map((t) => (
                        <button key={t.name} type="button" disabled aria-disabled="true">
                            <span className="os-tgt">{t.tag}</span><b>{t.name}</b><span className="os-sub">{t.what}</span>
                        </button>
                    ))}
                </div>
            </div>
        )
    } else if (step === 1) {
        body = (
            <div className="os-stack">
                <Field label="Title" htmlFor="os-prop-title" hint="One line." error={shown("title", draft.title)} count={`${v2CharCount(draft.title)} / ${V2_MAX_TITLE_CHARS}`}>
                    <input id="os-prop-title" className="os-in" value={draft.title} onChange={(ev) => set({ title: ev.target.value })} placeholder="A short, clear title" autoComplete="off" />
                </Field>
                {needsTarget(draft.kind) && (
                    <Field label={draft.kind === "add_member" ? "New member address" : "Member address"} htmlFor="os-prop-target" error={shown("target", draft.target)}>
                        <input id="os-prop-target" className="os-in os-mono" value={draft.target} onChange={(ev) => set({ target: ev.target.value })} placeholder="g1…" autoComplete="off" spellCheck={false} />
                    </Field>
                )}
                {draft.kind !== "add_member" && needsTarget(draft.kind) && (
                    <div className="os-chipset">{members.data.slice(0, 8).map((m) => (
                        <button key={m.address} type="button" aria-pressed={draft.target === m.address} onClick={() => set({ target: m.address })}>{m.username || `${m.address.slice(0, 8)}…`}</button>
                    ))}</div>
                )}
                {draft.kind === "add_member" && (
                    <Field label="Voting power" htmlFor="os-prop-power" hint={`Whole number. Total goes from ${e.totalPower} to ${e.totalPower + (e.power ?? 0)}.`} error={shown("power", draft.powerText)}>
                        <input id="os-prop-power" className="os-in" inputMode="numeric" value={draft.powerText} onChange={(ev) => set({ powerText: ev.target.value })} />
                    </Field>
                )}
                {needsRoles(draft.kind) && (
                    <Field label="Roles" hint="Roles are labels; they grant no special powers." error={e.problems.roles}>
                        <div className="os-chipset">{v2.roles.map((r) => {
                            const on = e.roles.includes(r)
                            return <button key={r} type="button" aria-pressed={on} onClick={() => set({ roles: on ? e.roles.filter((x) => x !== r) : [...e.roles, r] })}>{r}</button>
                        })}</div>
                    </Field>
                )}
                {draft.kind === "archive" && <p className="os-note os-err">Archiving is permanent. {v2.name} keeps its history but can never accept proposals again.</p>}
                <Field label="Description" htmlFor="os-prop-desc" hint="Optional. Context, motivation, links." error={shown("description", draft.description)} count={`${v2CharCount(draft.description)} / ${V2_MAX_DESCRIPTION_CHARS}`}>
                    <textarea id="os-prop-desc" className="os-in os-ta" value={draft.description} onChange={(ev) => set({ description: ev.target.value })} />
                </Field>
                {draft.kind === "text" && (
                    <Field label="Category" error={e.problems.category}>
                        <div className="os-chipset">{v2.categories.map((c) => (
                            <button key={c} type="button" aria-pressed={e.category === c} onClick={() => set({ category: c })}>{c}</button>
                        ))}</div>
                    </Field>
                )}
            </div>
        )
    } else {
        body = (
            <div className="os-stack os-tight">
                <h3 className="os-h">Review</h3>
                <div className="os-rv-title">Propose “{draft.title.trim()}”</div>
                <div className="os-sub">{TYPE_LABELS[draft.kind]} · {v2.name}</div>
                <dl className="os-kv">
                    <div className="os-kv-row"><dt>If it passes</dt><dd>{proposalEffect(draft, e, v2.name)}</dd></div>
                    <div className="os-kv-row"><dt>Voting</dt><dd>lasts {formatDuration(v2.voting_period)}</dd></div>
                    <div className="os-kv-row"><dt>Passes with</dt><dd>{v2.threshold} % yes{v2.quorum ? `, ${v2.quorum} % quorum` : ""}</dd></div>
                </dl>
                <p className="os-sub os-flush">Next, Memba shows the review and Adena opens.</p>
            </div>
        )
    }

    return (
        <WizardFrame steps={STEPS} step={step} onBack={() => setStep(step - 1)} onNext={next}
            nextLabel={step === STEPS.length - 1 ? "Propose…" : "Next"}
            note="Your draft is saved in this browser."
            preview={(
                <div className="os-stack os-tight">
                    <h3 className="os-h">Members will see</h3>
                    <div className="os-pvcard">
                        <span className="os-sub">{v2.name} · #{v2.proposal_count + 1}</span>
                        <b>{draft.title.trim() || <span className="os-sub">Your title</span>}</b>
                        <span className="os-sub">{TYPE_LABELS[draft.kind]}{draft.kind === "text" ? ` · ${e.category}` : ""}</span>
                        {draft.description && <span className="os-sub os-clamp">{draft.description}</span>}
                    </div>
                    <dl className="os-kv">
                        <div className="os-kv-row"><dt>Members</dt><dd>{v2.member_count}</dd></div>
                        <div className="os-kv-row"><dt>Passes with</dt><dd>{v2.threshold} % yes</dd></div>
                        <div className="os-kv-row"><dt>Voting</dt><dd>{formatDuration(v2.voting_period)}</dd></div>
                    </dl>
                </div>
            )}>
            {body}
        </WizardFrame>
    )
}
