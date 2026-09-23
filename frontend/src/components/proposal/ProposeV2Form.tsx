/**
 * ProposeV2Form — create a proposal in a version-2 DAO (template memba-dao/2).
 *
 * The proposal types offered are the DAO kind's capabilities; categories and
 * roles come from the DAO's own configuration. Every field is checked with the
 * realm's rules before signing, the preview is the exact message the wallet
 * signs, and the call carries a gas limit and deposit cap sized for its text.
 */
import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useOutletContext, useSearchParams } from "react-router-dom"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { getDAOConfig, getDAOMembers, invalidateProposalCache, type DaoAction } from "../../lib/dao"
import type { DaoProposalKind } from "../../lib/dao/kind"
import { isValidGnoAddressChecksum } from "../../lib/dao/address"
import { resolveRegisteredUsername } from "../../lib/dao/shared"
import { readV2Proposals } from "../../lib/dao/membaV2"
import { v2Context } from "../../lib/dao/membaV2Shell"
import { broadcastDaoTx, planDaoTx, planNeedsDepositOverride, proposalIdFromTxResult, type DaoTxPlan } from "../../lib/dao/daoTx"
import { DepositOverride } from "./DepositOverride"
import { formatUgnot } from "../../lib/dao/v2Budget"
import { formatDuration } from "../../lib/templates/dao/v2/duration"
import { friendlyDaoError } from "../../lib/dao/errors"
import { hasInvisibleFormatting, v2CharCount, v2DescriptionProblem, v2TitleProblem, V2_MAX_DESCRIPTION_CHARS, V2_MAX_TITLE_CHARS } from "../../lib/dao/v2Text"
import { logChainError } from "../../lib/errorLog"
import { useNetworkNav } from "../../hooks/useNetworkNav"
import type { LayoutContext } from "../../types/layout"
import { TxStatus, type TxState } from "./TxStatus"
import { useCurrentRequest } from "../../hooks/useCurrentRequest"
import { beginGovernanceRequest, governanceRequestActive, clearGovernanceReceipt, readGovernanceReceipt, saveGovernanceReceipt, readProposalDraft, saveProposalDraft, clearProposalDraft } from "../../lib/dao/governanceRecovery"
import "../../pages/proposedao.css"
import "../dao/dao-shell.css"

const TYPE_LABELS: Record<DaoProposalKind, string> = {
    text: "Text",
    add_member: "Add member",
    remove_member: "Remove member",
    change_role: "Change roles",
    archive: "Archive DAO",
}

const TYPE_HINTS: Record<DaoProposalKind, string> = {
    text: "A decision recorded on chain, with no automatic effect.",
    add_member: "If executed, adds the address as a member with the voting power and roles below.",
    remove_member: "If executed, removes the member and their voting power.",
    change_role: "If executed, replaces the member's roles with the roles selected below.",
    archive: "If executed, the DAO is archived permanently: no more proposals, votes or executions.",
}

const V2_MAX_POWER = 1_000_000_000

type Field = "title" | "description" | "category" | "target" | "power" | "roles"

function parsePower(raw: string): number | null {
    const digits = raw.replace(/[\s,_]/g, "")
    if (!/^[0-9]{1,10}$/.test(digits)) return null
    const n = Number(digits)
    return n >= 1 && n <= V2_MAX_POWER ? n : null
}

async function findCreatedProposal(realmPath: string, author: string, title: string, after: number): Promise<number | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const page = await readV2Proposals(v2Context(GNO_RPC_URL, realmPath), 0, 20)
            const match = page.proposals.find((p) => p.author === author && p.title === title && p.id > after)
            if (match) return match.id
        } catch {
            // The node may not have the new block yet.
        }
        await new Promise((r) => setTimeout(r, 1500))
    }
    return null
}

type Props = { realmPath: string; encodedSlug: string; kinds: ReadonlyArray<DaoProposalKind> }
export function ProposeV2Form(props: Props) {
    const { auth, adena } = useOutletContext<LayoutContext>()
    const [params] = useSearchParams()
    return <ScopedProposeV2Form key={`${GNO_CHAIN_ID}:${props.realmPath}:${adena.address}:${auth.isAuthenticated}:${params.toString()}`} {...props} />
}
function ScopedProposeV2Form({ realmPath, encodedSlug, kinds }: Props) {
    const navigate = useNetworkNav()
    const queryClient = useQueryClient()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const [params] = useSearchParams()
    const { isCurrent, assertCurrent } = useCurrentRequest()
    const scope = useMemo(() => ({ chainId: GNO_CHAIN_ID, realmPath, caller: adena.address || "", operation: "proposal" }), [realmPath, adena.address])
    // Explicit member-action links have their own draft so they cannot silently
    // replace either the requested action or an unfinished general proposal.
    const draftAction = JSON.stringify([params.get("type"), params.get("target"), params.get("roles")])
    const draftScope = useMemo(() => ({ ...scope, operation: `proposal-draft:${draftAction}` }), [scope, draftAction])
    const [savedDraft] = useState(() => readProposalDraft(draftScope))
    const [receipt, setReceipt] = useState(() => readGovernanceReceipt(scope))
    const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false)
    const [storageWarning, setStorageWarning] = useState("")
    // The exact signed message whose above-ceiling deposit cap the member allowed.
    const [depositApprovedFor, setDepositApprovedFor] = useState<string | null>(null)

    const initialKind = kinds.includes(params.get("type") as DaoProposalKind) ? params.get("type") as DaoProposalKind : kinds[0]
    const [kind, setKind] = useState<DaoProposalKind>(savedDraft && kinds.includes(savedDraft.kind) ? savedDraft.kind : initialKind)
    const [title, setTitle] = useState(savedDraft?.title ?? "")
    const [description, setDescription] = useState(savedDraft?.description ?? "")
    const [category, setCategory] = useState<string | null>(savedDraft?.category ?? null)
    const [target, setTarget] = useState(savedDraft?.target ?? params.get("target") ?? "")
    const [powerText, setPowerText] = useState(savedDraft?.powerText ?? "1")
    const [roles, setRoles] = useState<string[] | null>(savedDraft?.roles ?? (params.get("roles") !== null ? (params.get("roles") || "").split(",").filter(Boolean) : null))
    const [showErrors, setShowErrors] = useState(false)
    const [tx, setTx] = useState<TxState>({ phase: "idle" })
    const [locked, setLocked] = useState(!!receipt)

    useEffect(() => {
        try { saveProposalDraft(draftScope, { kind, title, description, category, target, powerText, roles }) }
        catch {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- communicate persistence failure.
            setStorageWarning("Draft changes are kept in this tab only. Copy them before closing it.")
        }
    }, [draftScope, kind, title, description, category, target, powerText, roles])

    const configQuery = useQuery({
        queryKey: ["dao", "config", realmPath],
        queryFn: () => getDAOConfig(GNO_RPC_URL, realmPath, true),
    })
    const membersQuery = useQuery({
        queryKey: ["dao", "members-list", realmPath, ""],
        queryFn: () => getDAOMembers(GNO_RPC_URL, realmPath, undefined, true),
    })
    const config = configQuery.data?.v2
    const members = membersQuery.data ?? null

    const trimmedTarget = target.trim()
    const targetValid = isValidGnoAddressChecksum(trimmedTarget) && trimmedTarget === trimmedTarget.toLowerCase()
    const targetMember = members?.find((m) => m.address === trimmedTarget) ?? null
    const usernameQuery = useQuery({
        queryKey: ["profile", "registered", GNO_CHAIN_ID, trimmedTarget],
        enabled: targetValid && kind !== "text" && kind !== "archive",
        queryFn: () => resolveRegisteredUsername(trimmedTarget),
    })

    if (configQuery.isPending || membersQuery.isPending) {
        return <div className="k-card pdao-form" role="status">Loading the DAO's settings…</div>
    }
    if (!config || !members) {
        return (
            <div className="k-card pdao-form" role="status">
                <p>The DAO's settings or members could not be read.</p>
                <button className="k-btn-secondary" onClick={() => { void configQuery.refetch(); void membersQuery.refetch() }}>Retry</button>
            </div>
        )
    }

    const caller = adena.address || ""
    const callerIsMember = !!caller && members.some((m) => m.address === caller)
    const selectedCategory = category ?? config.categories[0]
    const selectedRoles = (roles ?? (kind === "change_role" && targetMember ? targetMember.roles : [])).filter((r) => config.roles.includes(r))
    const power = parsePower(powerText)
    const totalPower = members.reduce((sum, m) => sum + m.votingPower, 0)

    const problems: Partial<Record<Field, string>> = {}
    const titleProblem = v2TitleProblem(title)
    if (titleProblem) problems.title = titleProblem
    const descriptionProblem = v2DescriptionProblem(description)
    if (descriptionProblem) problems.description = descriptionProblem
    if (kind === "text" && !config.categories.includes(selectedCategory)) problems.category = "Choose one of the DAO's categories."
    if (kind === "add_member" || kind === "remove_member" || kind === "change_role") {
        if (!trimmedTarget) problems.target = "Enter the member's address."
        else if (!isValidGnoAddressChecksum(trimmedTarget)) problems.target = "This is not a valid gno.land address."
        else if (trimmedTarget !== trimmedTarget.toLowerCase()) problems.target = "Enter the address in lower case."
        else if (kind === "add_member" && targetMember) problems.target = "This address is already a member."
        else if (kind !== "add_member" && !targetMember) problems.target = "This address is not a member of the DAO."
        else if (kind === "remove_member" && targetMember && (members.length <= 1 || totalPower - targetMember.votingPower < 1)) problems.target = "Removing this member would leave the DAO without voting power."
    }
    if (kind === "add_member") {
        if (power === null) problems.power = `Voting power must be a whole number from 1 to ${V2_MAX_POWER.toLocaleString("en-US")}.`
        if (members.length >= 100) problems.target = "This DAO already has the maximum of 100 members."
    }
    if ((kind === "add_member" || kind === "change_role") && selectedRoles.length !== (roles ?? selectedRoles).length) {
        problems.roles = "Some roles are not roles of this DAO."
    }

    const valid = Object.keys(problems).length === 0
    let action: DaoAction | null = null
    if (valid) {
        const t = title
        const d = description
        switch (kind) {
            case "text": action = { type: "propose-text", title: t, description: d, category: selectedCategory }; break
            case "add_member": action = { type: "propose-add-member", title: t, description: d, target: trimmedTarget, power: power!, roles: selectedRoles }; break
            case "remove_member": action = { type: "propose-remove-member", title: t, description: d, target: trimmedTarget }; break
            case "change_role": action = { type: "propose-change-role", title: t, description: d, target: trimmedTarget, roles: selectedRoles }; break
            case "archive": action = { type: "propose-archive", title: t, description: d }; break
        }
    }
    let plan: DaoTxPlan | null = null
    let needsDepositOverride = false
    if (action && caller) {
        try {
            plan = planDaoTx("memba-v2", realmPath, action, caller)
            needsDepositOverride = planNeedsDepositOverride(plan)
        } catch {
            plan = null
        }
    }
    const planKey = plan ? JSON.stringify(plan.msg) : null
    const depositApproved = !needsDepositOverride || (planKey !== null && depositApprovedFor === planKey)

    const blocked = !auth.isAuthenticated || !caller ? "Connect your wallet to create a proposal."
        : config.archived ? "This DAO is archived. It no longer accepts proposals."
            : !callerIsMember ? "Only members of this DAO can create proposals. Your connected wallet is not a member."
                : null
    const busy = tx.phase === "wallet" || tx.phase === "block"
    const disabled = locked || busy || !auth.isAuthenticated || !caller
    const shown = (field: Field, value: string) => (showErrors || value !== "") ? problems[field] : undefined

    const submit = async () => {
        setShowErrors(true)
        if (blocked || !plan || !action || disabled || !depositApproved || governanceRequestActive(scope)) return
        const before = config.proposal_count
        const submittedTitle = title
        let finish = () => {}
        let walletStarted = false
        let submittedHash = ""
        setTx({ phase: "wallet" })
        try {
            finish = beginGovernanceRequest(scope)
            saveGovernanceReceipt(scope, { phase: "intent", hash: "", label: submittedTitle })
            const res = await broadcastDaoTx(plan, action, `Propose: ${submittedTitle}`, async () => {
                assertCurrent()
                const [freshConfig, freshMembers] = await Promise.all([getDAOConfig(GNO_RPC_URL, realmPath, true), getDAOMembers(GNO_RPC_URL, realmPath, undefined, true)])
                assertCurrent()
                if (!freshConfig?.v2 || freshConfig.v2.archived || !freshMembers.some(m => m.address === caller)) throw new Error("DAO membership or availability changed. Review your proposal again.")
                if (freshConfig.v2.electorate_version !== config.electorate_version) throw new Error("DAO membership changed. Review the proposal again.")
                walletStarted = true
            }, { approvedDepositUgnot: needsDepositOverride && depositApproved ? plan.maxDepositUgnot : undefined })
            submittedHash = res.hash
            const saved = { phase: "submitted" as const, hash: res.hash, label: submittedTitle }
            try { saveGovernanceReceipt(scope, saved) } catch { if (isCurrent()) setStorageWarning("The transaction receipt is kept in this tab only. Copy its hash before leaving.") }
            if (!isCurrent()) return
            setReceipt(saved)
            setLocked(true)
            setTx({ phase: "block", hash: res.hash })
            invalidateProposalCache(realmPath)
            void queryClient.invalidateQueries({ queryKey: ["dao", "proposals", realmPath] })
            void queryClient.invalidateQueries({ queryKey: ["dao", "config", realmPath] })
            const id = proposalIdFromTxResult(res.result) ?? await findCreatedProposal(realmPath, caller, submittedTitle, before)
            if (!isCurrent()) return
            if (id !== null) {
                try { saveGovernanceReceipt(scope, { phase: "confirmed", hash: res.hash, label: submittedTitle, proposalId: id }) } catch { /* Known hash remains in memory. */ }
                setTx({ phase: "confirmed", hash: res.hash, message: `Proposal #${id} created. Opening it…` })
                navigate(`/dao/${encodedSlug}/proposal/${id}`)
            } else {
                setTx({ phase: "submitted", hash: res.hash, message: "Proposal submitted. It will appear in the DAO's proposals once the network shows it." })
            }
        } catch (err) {
            if (!walletStarted && !submittedHash) {
                // The request never reached Adena; it is safe to edit and try again.
                finish()
                try { clearGovernanceReceipt(scope) } catch { /* Retain a conservative recovery record. */ }
            } else if (isCurrent()) { setLocked(true); setReceipt(readGovernanceReceipt(scope)) }
            if (!isCurrent()) return
            logChainError(`proposal:propose:${realmPath}`, err, "critical", caller)
            setTx({ phase: walletStarted ? "unknown" : "failed", message: walletStarted ? "Submission outcome unknown. Check the transaction before submitting again." : friendlyDaoError(err), hash: submittedHash })
        } finally { finish() }
    }

    const needsTarget = kind === "add_member" || kind === "remove_member" || kind === "change_role"
    const needsRoles = kind === "add_member" || kind === "change_role"

    return (
        <form className="pdao-page" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate aria-label="New proposal">
            {blocked && <div className="dao-shell-banner" role="status">{blocked}</div>}

            <fieldset className="k-card pdao-form" disabled={disabled} style={{ border: "none", margin: 0, minWidth: 0 }}>
                <div role="group" aria-labelledby="v2-type-label">
                    <span id="v2-type-label" className="pdao-label">Proposal type</span>
                    <div className="pdao-chip-row">
                        {kinds.map((k) => (
                            <button key={k} type="button" className={`pdao-chip ${kind === k ? "active" : ""}`} aria-pressed={kind === k} onClick={() => { setKind(k); setRoles(null) }}>
                                {TYPE_LABELS[k]}
                            </button>
                        ))}
                    </div>
                    <p className="pdao-hint">{TYPE_HINTS[kind]}</p>
                </div>

                {kind === "text" && (
                    <div role="group" aria-labelledby="v2-category-label">
                        <span id="v2-category-label" className="pdao-label">Category</span>
                        <div className="pdao-chip-row">
                            {config.categories.map((c) => (
                                <button key={c} type="button" className={`pdao-chip ${selectedCategory === c ? "active" : ""}`} aria-pressed={selectedCategory === c} onClick={() => setCategory(c)}>
                                    {c}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {needsTarget && (
                    <div>
                        <label className="pdao-label" htmlFor="v2-target">{kind === "add_member" ? "New member address" : "Member address"}</label>
                        <input id="v2-target" className="pdao-input" value={target} onChange={(e) => { setTarget(e.target.value); setRoles(null) }} placeholder="g1…" spellCheck={false} autoComplete="off" maxLength={60} aria-invalid={!!shown("target", target)} aria-describedby="v2-target-hint" />
                        <p id="v2-target-hint" className="pdao-hint">
                            {shown("target", target) ?? (targetValid ? (usernameQuery.data ? `Registered name: ${usernameQuery.data}` : "No registered name for this address.") : "The full g1 address.")}
                        </p>
                    </div>
                )}

                {kind === "add_member" && (
                    <div>
                        <label className="pdao-label" htmlFor="v2-power">Voting power</label>
                        <input id="v2-power" className="pdao-input" inputMode="numeric" value={powerText} onChange={(e) => setPowerText(e.target.value)} aria-invalid={!!problems.power} aria-describedby="v2-power-hint" />
                        <p id="v2-power-hint" className="pdao-hint">
                            {problems.power ?? `${power!.toLocaleString("en-US")} of ${(totalPower + power!).toLocaleString("en-US")} total voting power after the change.`}
                        </p>
                    </div>
                )}

                {needsRoles && (
                    <div role="group" aria-labelledby="v2-roles-label">
                        <span id="v2-roles-label" className="pdao-label">Roles</span>
                        {config.roles.length === 0 ? <p className="pdao-hint">This DAO defines no roles.</p> : (
                            <div className="pdao-chip-row">
                                {config.roles.map((r) => {
                                    const on = selectedRoles.includes(r)
                                    return (
                                        <button key={r} type="button" className={`pdao-role-chip ${on ? "active" : ""}`} aria-pressed={on} onClick={() => setRoles(on ? selectedRoles.filter((x) => x !== r) : config.roles.filter((x) => x === r || selectedRoles.includes(x)))}>
                                            {r}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                        <p className="pdao-hint">{problems.roles ?? "Roles are labels; they grant no special powers."}</p>
                    </div>
                )}

                {kind === "archive" && (
                    <p className="dao-shell-banner" role="note"><strong>Archiving is permanent.</strong> Once executed, the DAO accepts no more proposals, votes or executions.</p>
                )}

                <div>
                    <label className="pdao-label" htmlFor="v2-title">Title</label>
                    <input id="v2-title" className="pdao-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!shown("title", title)} aria-describedby="v2-title-hint" />
                    <p id="v2-title-hint" className="pdao-hint">{shown("title", title) ?? `${v2CharCount(title)}/${V2_MAX_TITLE_CHARS} characters, one line`}</p>
                </div>

                <div>
                    <label className="pdao-label" htmlFor="v2-description">Description</label>
                    <textarea id="v2-description" className="pdao-textarea" rows={8} value={description} onChange={(e) => setDescription(e.target.value.replace(/\r\n?/g, "\n"))} aria-invalid={!!problems.description} aria-describedby="v2-description-hint" />
                    <p id="v2-description-hint" className="pdao-hint">{problems.description ?? `${v2CharCount(description).toLocaleString("en-US")}/${V2_MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters`}</p>
                    {hasInvisibleFormatting(description) && (
                        <p className="dao-shell-banner" role="alert">
                            The description contains invisible formatting characters (for example zero-width or text-direction characters). They can make text read differently from what it says. Remove them unless you need them.
                        </p>
                    )}
                </div>
            </fieldset>

            <div className="k-card pdao-summary">
                <div className="pdao-summary-row"><span>Realm</span><span>{realmPath}</span></div>
                <div className="pdao-summary-row"><span>Proposer</span><span>{caller || "—"}</span></div>
                <div className="pdao-summary-row"><span>Voting period</span><span>Voting closes {formatDuration(config.voting_period)} after the proposal is created</span></div>
                {plan && (
                    <>
                        <div className="pdao-summary-row"><span>Gas limit</span><span>{plan.gasWanted!.toLocaleString("en-US")}</span></div>
                        <div className="pdao-summary-row"><span>Storage deposit</span><span>Requested cap {formatUgnot(plan.maxDepositUgnot!)}, locked in the DAO realm for the data this proposal stores</span></div>
                    </>
                )}
            </div>

            <details className="pdao-source-details">
                <summary className="pdao-source-summary">Transaction to sign</summary>
                <pre className="pdao-source-pre" data-testid="v2-signed-message">
                    {plan ? JSON.stringify(plan.msg, null, 2) : "Complete the form to see the transaction."}
                </pre>
            </details>

            {plan && needsDepositOverride && (
                <DepositOverride
                    maxDepositUgnot={plan.maxDepositUgnot!}
                    approved={depositApproved}
                    onApprovedChange={(approved) => setDepositApprovedFor(approved ? planKey : null)}
                />
            )}

            {storageWarning && <p role="status">{storageWarning}</p>}
            {receipt && <div className="dao-shell-banner" role="status">
                <p>{receipt.hash ? "A proposal submission is recorded. Check it before starting another." : "A previous submission attempt has an unknown outcome. Check your wallet and the DAO before submitting again."}</p>
                {receipt.hash && <code>Transaction {receipt.hash}</code>}
                <label><input type="checkbox" checked={recoveryAcknowledged} onChange={e => setRecoveryAcknowledged(e.target.checked)} /> I checked the previous transaction and want to review another proposal.</label>
                <button type="button" className="k-btn-secondary" disabled={busy || !recoveryAcknowledged} onClick={() => {
                    try { clearGovernanceReceipt(scope); clearProposalDraft(draftScope); setReceipt(null); setLocked(false); setTitle(""); setDescription(""); setTx({ phase: "idle" }); setRecoveryAcknowledged(false) }
                    catch (error) { setStorageWarning(error instanceof Error ? error.message : "Could not clear the saved attempt.") }
                }}>Review another proposal</button>
            </div>}
            <TxStatus state={tx} />

            <div className="pdao-actions">
                <button type="submit" className="k-btn-primary" disabled={!!blocked || disabled || !depositApproved} style={{ flex: 1 }}>
                    {busy ? "Submitting…" : locked ? "Submitted" : "Submit proposal"}
                </button>
                <button type="button" className="k-btn-secondary" onClick={() => navigate(`/dao/${encodedSlug}`)} disabled={busy}>
                    {locked ? "Back to DAO" : "Cancel"}
                </button>
            </div>
        </form>
    )
}
