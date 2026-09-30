import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useOutletContext, useParams } from "react-router-dom"
import { NETWORKS, GNO_CHAIN_ID, GNO_RPC_URL } from "../lib/config"
import { isUnreadableProposal, readWeightedBallot, weightedApplicationPolicies, weightedWritesSupported, weightedWriteKinds, weightedWritesHeld, weightedVoteChoices, weightedAuthority, assertWeightedWrites, assertWeightedPlanSignable, planWeightedTx, readWeightedSnapshot, WEIGHTED_APPLICATIONS_SCHEMA, type WeightedAction, type WeightedConfig, type WeightedBallot, type WeightedContext, type WeightedPageEntry, type WeightedProposal, type WeightedWriteKind, applicationActionTitle } from "../lib/dao/weighted"
import { revealInvisibleFormatting as reveal } from "../lib/dao/v2Text"
import { ACCEPT_FUNCS, acceptAdapterFor, applicationDetails, flattenBefore, type ApplicationPolicyKey, type WeightedApplicationAction } from "../lib/dao/weightedApplications"
import { ACCEPTANCE_CONSEQUENCES, ACCEPTANCE_LABELS, ACCEPTANCE_ORDER, AUTHORITY_GETTERS, nextRecommendedAcceptance, acceptanceState, readAcceptanceStates, readTargetAuthority, weightedDaoAddress, type AcceptanceState } from "../lib/dao/weightedAcceptance"
import { broadcastWeightedPlan, checkWeightedAction, weightedLocks, weightedMemo } from "../lib/dao/weightedActions"
import { v12CallBudget } from "../lib/dao/weightedBudget"
import { CATEGORY_TEXT, EXECUTION_INVALIDATES, POLICY_LABELS, STATUS_TEXT, UNREADABLE_PROPOSAL, executionWarning, applicationRules, ballotText, decisionRules, invalidationRule, isOpenProposal, isVoteOpen, openProposalsOf, proposalTimes, roleText, seatText, seatsRule, statusNote, tallyText, votingRule, weightedReadError, type BallotView, ROLES_ADD_NOTHING, seatsSummary, writesHeldText } from "../lib/dao/weightedView"
import { WalletNetworkError } from "../lib/walletNetworkGuard"
import { assertLiveWalletChain } from "../lib/dao/weightedWallet"
import { formatUgnotExact } from "../lib/dao/v2Budget"
import { proposalIdFromTxResult } from "../lib/dao/daoTx"
import type { LayoutContext } from "../types/layout"
import "./weighteddao.css"

type Snapshot = Awaited<ReturnType<typeof readWeightedSnapshot>>
type AcceptanceStates = Partial<Record<ApplicationPolicyKey, AcceptanceState | "error">>
const NO_KINDS: ReadonlySet<WeightedWriteKind> = new Set()

/** Separate route: the weighted host is not a legacy equal-headcount DAO. */
export function WeightedDAO() {
    const { "*": realmPath = "", network = "" } = useParams()
    const { adena, auth } = useOutletContext<LayoutContext>()
    const selected = NETWORKS[network]
    if (!selected) return <p role="alert">Select a supported network.</p>
    const ctx = { realmPath, rpcUrl: selected.rpcUrl, chainId: selected.chainId }
    return <WeightedWorkspace key={`${network}:${realmPath}:${adena.address}:${adena.chainId}:${adena.connected}:${auth.address}:${auth.isAuthenticated}`} ctx={ctx} wallet={adena} authenticated={auth.isAuthenticated && auth.address === adena.address} />
}

function WeightedWorkspace({ ctx, wallet, authenticated }: { ctx: WeightedContext; wallet: LayoutContext["adena"]; authenticated: boolean }) {
    const [data, setData] = useState<Snapshot | null>(null)
    const [before, setBefore] = useState("0")
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [target, setTarget] = useState("")
    const [role, setRole] = useState<"admin" | "finance">("admin")
    const [grant, setGrant] = useState(true)
    const [recoverTarget, setRecoverTarget] = useState("")
    const [replacement, setReplacement] = useState("")
    const active = useRef(false)
    const operation = useRef(false)
    const request = useRef(0)
    const { rpcUrl, chainId, realmPath } = ctx
    useLayoutEffect(() => { active.current = true; return () => { active.current = false } }, [])
    const refresh = useCallback(async (cursor: string, signal?: AbortSignal) => {
        const ticket = ++request.current
        setLoading(true); setError(""); setData(null)
        try {
            const fresh = await readWeightedSnapshot({ rpcUrl, chainId, realmPath }, cursor, signal)
            if (active.current && ticket === request.current) { setData(fresh); setBefore(cursor) }
        } catch (err) {
            if (active.current && ticket === request.current) setError(weightedReadError(err))
        } finally { if (active.current && ticket === request.current) setLoading(false) }
    }, [rpcUrl, chainId, realmPath])
    useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => { if (!controller.signal.aborted) return refresh("0", controller.signal) }); return () => controller.abort() }, [refresh])
    // Read-only ballot indicators for the connected address (v12 publishes ballots).
    // Results are tagged with the snapshot and voter they answer, so a stale
    // answer is never shown for a newer page or another wallet.
    const [ballotState, setBallotState] = useState<{ data: Snapshot | null; voter: string; ballots: Record<string, WeightedBallot | "error"> }>({ data: null, voter: "", ballots: {} })
    const voter = wallet.connected && /^g1[0-9a-z]{38}$/.test(wallet.address) ? wallet.address : ""
    const ballots = ballotState.data === data && ballotState.voter === voter ? ballotState.ballots : {}
    useEffect(() => {
        if (!data || !voter || data.config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) return
        const controller = new AbortController()
        const ids = data.page.proposals.filter(p => !isUnreadableProposal(p)).map(p => p.id)
        void Promise.all(ids.map(id => readWeightedBallot({ rpcUrl, chainId, realmPath }, id, voter, controller.signal)
            .then(b => [id, b] as const, () => [id, "error"] as const)))
            .then(entries => { if (active.current && !controller.signal.aborted) setBallotState({ data, voter, ballots: Object.fromEntries(entries) }) })
        return () => controller.abort()
    }, [data, voter, rpcUrl, chainId, realmPath])
    // Acceptance readiness of each adapter target (v12), tagged with the
    // snapshot it answers so a stale read never shows for a newer page.
    const [acceptanceView, setAcceptanceView] = useState<{ data: Snapshot | null; states: AcceptanceStates }>({ data: null, states: {} })
    const acceptance = acceptanceView.data === data ? acceptanceView.states : {}
    useEffect(() => {
        if (!data || data.config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) return
        const controller = new AbortController()
        void readAcceptanceStates({ rpcUrl, chainId, realmPath }, weightedApplicationPolicies(data.config), controller.signal)
            .then(states => states, () => Object.fromEntries(weightedApplicationPolicies(data.config).map(({ key }) => [key, "error"])) as AcceptanceStates)
            .then(states => { if (active.current && !controller.signal.aborted) setAcceptanceView({ data, states }) })
        return () => controller.abort()
    }, [data, rpcUrl, chainId, realmPath])
    const member = data?.members.find(m => m.address === wallet.address)
    const writable = !!data && weightedWritesSupported(data.config.schema)
    const kinds = data ? weightedWriteKinds(data.config.schema, chainId, realmPath) : NO_KINDS
    const held = weightedWritesHeld(chainId, data?.config.schema ?? "", realmPath)
    // A member who could act here once the current read or submission settles.
    const eligible = kinds.size > 0 && !!member && wallet.connected && authenticated && wallet.chainId === chainId && chainId === GNO_CHAIN_ID && rpcUrl === GNO_RPC_URL && !held
    const canAct = eligible && !busy && !loading
    const recoverySeat = data?.members.find(m => m.address === recoverTarget)
    const applications = data?.config.schema === WEIGHTED_APPLICATIONS_SCHEMA
    // Open proposals on the newest page: executing any one invalidates the others.
    const newestOpen = data && before === "0" ? openProposalsOf(data.page) : { open: [], complete: false }
    const openProposals = newestOpen.open
    const submit = async (action: WeightedAction) => {
        if (operation.current || !canAct || !kinds.has(action.type)) return
        operation.current = true; setBusy(true); setError(""); setNotice("")
        // Leaving the page, or changing network, realm, wallet or session, remounts this workspace (see
        // its key), so `active` is what says any of them moved. The browser address is no such sign:
        // inside a Memba OS window it follows whichever window is in front.
        const assertCurrent = () => {
            if (!active.current) throw new Error("Wallet or page changed; prepare the action again")
            assertWeightedWrites(chainId, GNO_CHAIN_ID, wallet.chainId, data?.config.schema ?? "", realmPath, action.type)
            if (rpcUrl !== GNO_RPC_URL) throw new Error("Selected RPC changed")
        }
        const isV12 = data?.config.schema === WEIGHTED_APPLICATIONS_SCHEMA
        try {
            // A vote or execution signed in the Memba OS proposal window with an unknown outcome locks this one too.
            if ((action.type === "vote" || action.type === "execute") && weightedLocks(chainId, realmPath, wallet.address, action.id).length) {
                throw new Error(`An earlier attempt on proposal #${action.id} has an unknown outcome; check it in the proposal's Memba OS window before trying again`)
            }
            const check = { ctx, caller: wallet.address, action, assertCurrent }
            const { snapshot: fresh, executes } = await checkWeightedAction({ ...check, phase: "review", reviewed: data ? weightedAuthority(data) : null })
            const plan = planWeightedTx(wallet.address, realmPath, action, fresh.config.schema, chainId, executes)
            assertWeightedPlanSignable(plan)
            const beforeSign = async () => {
                assertCurrent()
                assertWeightedPlanSignable(plan)
                await checkWeightedAction({ ...check, phase: "sign", reviewed: weightedAuthority(fresh), executes })
                // doContractBroadcast runs the shared wallet-network guard before and
                // after these rechecks; v12 adds only the governance hold list.
                if (isV12) { await assertLiveWalletChain({ chainId, address: wallet.address, schema: fresh.config.schema, realmPath }); assertCurrent() }
            }
            const memo = weightedMemo(action, fresh)
            const result = await broadcastWeightedPlan(plan, memo, beforeSign)
            assertCurrent()
            const created = action.type === "accept" ? proposalIdFromTxResult(result.result) : null
            let outcome = `Transaction submitted: ${result.hash}. Verify its result in the refreshed proposal list.`
            if (action.type === "accept") outcome = `Transaction submitted: ${result.hash}. ${created ? `Acceptance proposal #${created} is open for votes.` : "Find the new acceptance proposal in the refreshed list."}`
            const executedAdapter = action.type === "execute" && executes && fresh.config.schema === WEIGHTED_APPLICATIONS_SCHEMA ? acceptAdapterFor(executes) : null
            if (executedAdapter && fresh.config.schema === WEIGHTED_APPLICATIONS_SCHEMA) {
                // Confirm the handoff on the target itself, not only the DAO's status.
                const policy = fresh.config[executedAdapter]
                const after = await readTargetAuthority(ctx, executedAdapter, policy.target, policy.successor).then(read => acceptanceState(read, weightedDaoAddress(realmPath)), () => null)
                assertCurrent()
                outcome = after?.kind === "dao" && after.pending === ""
                    ? `Transaction submitted: ${result.hash}. ${reveal(policy.target)} now names the DAO as its ${AUTHORITY_GETTERS[executedAdapter].authority}.`
                    : `Transaction submitted: ${result.hash}. ${reveal(policy.target)} does not show the DAO as its ${AUTHORITY_GETTERS[executedAdapter].authority} yet; check the proposal result after the refresh.`
            }
            setNotice(outcome)
            await refresh("0")
        } catch (err) {
            // A wallet-network refusal already says what to do (unlock, reconnect, switch network) and sent nothing.
            if (active.current) setError(err instanceof WalletNetworkError ? err.message
                : `${err instanceof Error && err.name !== "ZodError" ? err.message : "Invalid action data; verify the replacement address and its checksum"}. No automatic retry. Refresh chain state before trying again.`)
        } finally { operation.current = false; if (active.current) setBusy(false) }
    }
    return <div className="weighted-dao">
        <header><p className="weighted-dao__eyebrow">Founding governance</p><h1>Memba weighted DAO</h1><p className="weighted-dao__path">{reveal(realmPath)}</p><p>{chainId} · {applications ? "Role and application governance" : "Role governance"}</p></header>
        <section className="k-card" aria-labelledby="weighted-policy"><h2 id="weighted-policy">How decisions pass</h2>
            {data && <>
                <p>{seatsSummary(data.config)}. {seatsRule(data.config)}</p>
                {decisionRules(data.config).map(rule => <p key={rule.category}>{CATEGORY_TEXT[rule.category]} decisions ({rule.covers}) pass with {rule.routes.map((route, i) => <Fragment key={route}>{i > 0 && ", or "}<strong>{route}</strong></Fragment>)}{rule.delayed ? "." : " and can execute as soon as they pass."}</p>)}
            </>}
            {data && <p>{votingRule(data.config)} {invalidationRule(data.config)}</p>}
            <p>{ROLES_ADD_NOTHING}</p>
        </section>
        {data && held && <p role="status">{writesHeldText(chainId)}</p>}
        <p>{applications ? "Fixed application actions are available for the adapters below. Migration and treasury spending are not." : "Migration, treasury spending and application actions are not available in this DAO version."}</p>
        <button disabled={loading || busy} onClick={() => void refresh("0")}>Refresh chain state</button>
        {loading && <p role="status">Reading governance state…</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status" className="weighted-dao__path">{notice}</p>}
        {data && <>
            <section aria-labelledby="weighted-members"><h2 id="weighted-members">Members and roles</h2><ul className="weighted-dao__members">{data.members.map(m => <li className="k-card" key={m.address}>
                <strong>{reveal(m.personId)}</strong><span>{seatText(m)}</span>
                <code>{reveal(m.address)}</code><span>{roleText(m)}</span>
            </li>)}</ul></section>
            {applications && <ApplicationPolicies config={data.config} acceptance={acceptance} canAccept={canAct && kinds.has("accept")} eligible={eligible && kinds.has("accept")} held={held} openProposals={openProposals} submit={submit} />}
            <section className="k-card" aria-labelledby="weighted-propose"><h2 id="weighted-propose">Propose a role change</h2>
                {!writable ? <p>This DAO version is read-only in Memba for now. Voting and proposing arrive in a later release.</p>
                    : applications ? <p>Role proposals for this DAO version arrive in a later Memba release. Use the adapter acceptances and proposal votes below.</p>
                    : !canAct && !busy && <p>Actions require a connected, authenticated member on the selected network.</p>}
                <form onSubmit={e => { e.preventDefault(); void submit({ type: "propose", target, role, grant }) }}><fieldset disabled={!canAct || !kinds.has("propose")}>
                    <label>Member<select value={target} onChange={e => setTarget(e.target.value)} required><option value="">Choose a member</option>{data.members.map(m => <option key={m.address} value={m.address}>{reveal(m.personId)} — {reveal(m.address)}</option>)}</select></label>
                    <label>Role<select value={role} onChange={e => setRole(e.target.value as "admin" | "finance")}><option value="admin">Admin</option><option value="finance">Finance</option></select></label>
                    <label>Change<select value={String(grant)} onChange={e => setGrant(e.target.value === "true")}><option value="true">Grant role</option><option value="false">Remove role</option></select></label>
                    <button type="submit" disabled={!target}>Review role proposal</button>
                </fieldset></form>
            </section>
            {data.config.capabilities.memberReplacement ? <section className="k-card" aria-labelledby="weighted-recover"><h2 id="weighted-recover">Recover a member’s DAO key</h2>
                <p>Replace one person’s DAO address while preserving their identity, voting weight and roles. The old key loses DAO access after execution. This does not rotate the operations or reserve multisig.</p>
                <form onSubmit={e => { e.preventDefault(); if (recoverySeat) void submit({ type: "recover", personId: recoverySeat.personId, oldAddress: recoverySeat.address, newAddress: replacement }) }}><fieldset disabled={!canAct || !kinds.has("recover")}>
                    <label>Recovery member<select value={recoverTarget} onChange={e => setRecoverTarget(e.target.value)} required><option value="">Choose a member</option>{data.members.map(m => <option key={m.address} value={m.address}>{reveal(m.personId)} — {reveal(m.address)}</option>)}</select></label>
                    {recoverySeat && <p className="weighted-dao__path">Current address: {reveal(recoverySeat.address)}. Preserve {recoverySeat.weight} voting {recoverySeat.weight === 1 ? "point" : "points"}{recoverySeat.admin ? ", Admin" : ""}{recoverySeat.finance ? ", Finance" : ""}.</p>}
                    <label>Replacement Gno address<input value={replacement} onChange={e => setReplacement(e.target.value)} required autoComplete="off" spellCheck={false} maxLength={40} /></label>
                    <button type="submit" disabled={!recoverySeat || !replacement}>Review key recovery proposal</button>
                </fieldset></form>
            </section> : <p>This v1 DAO does not support member-key recovery.</p>}
            <section aria-labelledby="weighted-proposals"><h2 id="weighted-proposals">Governance proposals</h2><p>{data.page.total} proposals recorded</p>
                {data.page.proposals.length === 0 && <p>No proposals on this page.</p>}
                {data.page.proposals.map(p => <ProposalEntry key={p.id} proposal={p} ballot={ballots[p.id]} canAct={canAct} kinds={kinds} ballotAware={applications} otherOpen={openProposals.filter(o => o.id !== p.id).map(o => o.id)} allOpenKnown={newestOpen.complete} submit={submit} />)}
                <div className="weighted-dao__actions">{before !== "0" && <button disabled={loading || busy} onClick={() => void refresh("0")}>Newest proposals</button>}{data.page.nextBefore && <button disabled={loading || busy} onClick={() => void refresh(data.page.nextBefore!)}>Older proposals</button>}</div>
            </section>
        </>}
    </div>
}

function ApplicationPolicies({ config, acceptance, canAccept, eligible, held, openProposals, submit }: { config: WeightedConfig; acceptance: AcceptanceStates; canAccept: boolean; eligible: boolean; held: boolean; openProposals: WeightedProposal[]; submit: (action: WeightedAction) => Promise<void> }) {
    const openAccept = openProposals.find(p => acceptAdapterFor(p.action) !== null)
    const policies = new Map(weightedApplicationPolicies(config).map(({ key, policy }) => [key, policy]))
    const next = nextRecommendedAcceptance(acceptance)
    const critical = decisionRules(config)[0]
    return <section aria-labelledby="weighted-adapters"><h2 id="weighted-adapters">Application adapters</h2>
        <p>Each adapter governs one fixed realm. A return proposal only stages the configured successor, who must accept separately.</p>
        <div className="k-card weighted-dao__handoff" aria-labelledby="weighted-handoff">
            <h3 id="weighted-handoff">Handing a target over to the DAO</h3>
            <p>The publisher first nominates the DAO as the target's pending owner. Then each acceptance is a critical proposal:</p>
            <ol>
                <li>Any member proposes the acceptance.</li>
                <li>It passes with {critical.routes.join(", or ")}.</li>
                <li>Any member executes it. The page then reads the target again to confirm the DAO controls it.</li>
            </ol>
            <p>{votingRule(config)}</p>
            <p className="weighted-dao__warning" role="note">One open acceptance at a time: executing any application action invalidates every other open proposal. Propose the next acceptance only after the previous one has executed, in the numbered order below.</p>
        </div>
        {held && <p>Memba builds no acceptance proposal for this DAO here while it is read-only.</p>}
        <ol className="weighted-dao__adapters">{ACCEPTANCE_ORDER.map((key, index) => {
            const policy = policies.get(key)
            if (!policy) return null
            return <li className={`k-card${key === next ? " weighted-dao__adapter--next" : ""}`} key={key} aria-label={`${key} adapter`}>
                <p className="weighted-dao__eyebrow">Handoff {index + 1} of {ACCEPTANCE_ORDER.length}{key === next && <> · <strong className="weighted-dao__next">Next recommended</strong></>}</p>
                <h3>{POLICY_LABELS[key]}</h3>
                <p className="weighted-dao__path">Target: {reveal(policy.target)}</p>
                {"treasury" in policy && <p className="weighted-dao__path">Treasury: {reveal(policy.treasury)}</p>}
                {applicationRules(key, policy).map(rule => <p key={rule}>{rule}</p>)}
                <p className="weighted-dao__consequence">{ACCEPTANCE_CONSEQUENCES[key]}</p>
                <AdapterAuthority adapter={key} state={acceptance[key]} dao={weightedDaoAddress(config.realmPath)} canAccept={canAccept} eligible={eligible} held={held} openAccept={openAccept?.id} next={next} submit={submit} />
            </li>
        })}</ol>
    </section>
}

function AdapterAuthority({ adapter, state, dao, canAccept, eligible, held, openAccept, next, submit }: { adapter: ApplicationPolicyKey; state: AcceptanceState | "error" | undefined; dao: string; canAccept: boolean; eligible: boolean; held: boolean; openAccept?: string; next: ApplicationPolicyKey | null; submit: (action: WeightedAction) => Promise<void> }) {
    const role = AUTHORITY_GETTERS[adapter].authority
    if (state === undefined) return <p className="weighted-dao__authority" role="status">Reading the target's {role}…</p>
    if (state === "error") return <p className="weighted-dao__authority">Handoff status: the target's {role} could not be read. Refresh chain state to try again.</p>
    const budget = v12CallBudget(ACCEPT_FUNCS[adapter])
    return <div className="weighted-dao__authority" data-state={state.kind}>
        <p><strong>{ACCEPTANCE_LABELS[state.kind]}</strong></p>
        {state.kind === "awaiting" && <>
            <p className="weighted-dao__path">Current {role}: {reveal(state.current || "(none)")}. Pending {role}: {reveal(state.pending || "(none)")}.</p>
            <p className="weighted-dao__path">The publisher must first nominate the DAO ({dao}) as pending {role}.</p>
        </>}
        {state.kind === "blocked" && <>
            <p className="weighted-dao__path">The DAO is the pending {role}. Current {role}: {reveal(state.current)}.</p>
            <ul>{state.reasons.map(r => <li key={r}>{r}</li>)}</ul>
        </>}
        {state.kind === "dao" && <p className="weighted-dao__path">The DAO is the current {role}.{state.pending ? ` A handover back to ${reveal(state.pending)} is pending.` : ""}</p>}
        {state.kind === "ready" && <>
            <p className="weighted-dao__path">The DAO is the pending {role}. Current {role}: {reveal(state.current)}.</p>
            <p>The proposal locks up to {formatUgnotExact(budget.maxDepositUgnot)} of storage deposit from the proposer.</p>
            {openAccept && <p>Acceptance proposal #{openAccept} is still open. Propose this one after it executes or closes.</p>}
            {next && next !== adapter && <p>The recommended order hands over {POLICY_LABELS[next]} first.</p>}
            {!eligible && !held && <p>Proposing requires a connected, authenticated member on the selected network.</p>}
            <button type="button" disabled={!canAccept || !!openAccept} onClick={() => void submit({ type: "accept", adapter })}>Propose acceptance</button>
        </>}
    </div>
}

function ProposalAction({ action }: { action: WeightedProposal["action"] }) {
    if (action.type === "set-role") return <><h3>{action.grant ? "Grant" : "Remove"} {action.role}</h3><p className="weighted-dao__path">Target: {reveal(action.target)}</p></>
    if (action.type === "recover-member") return <><h3>Recover member key</h3><p>Person: {reveal(action.personId)}</p><p className="weighted-dao__path">Old address: {reveal(action.oldAddress)}</p><p className="weighted-dao__path">Replacement address: {reveal(action.newAddress)}</p><p>Identity, voting weight and roles are preserved.</p></>
    return <ApplicationAction action={action} />
}

function ApplicationAction({ action }: { action: WeightedApplicationAction }) {
    const details = applicationDetails(action)
    return <>
        <h3>{applicationActionTitle(action)}</h3>
        <p className="weighted-dao__path">Target realm: {reveal(action.target)}</p>
        {details.length > 0 && <dl className="weighted-dao__facts">{details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        <details className="weighted-dao__before"><summary>State frozen at proposal time</summary>
            <p>Execution is refused if the target realm no longer matches this state.</p>
            <dl className="weighted-dao__facts">{flattenBefore(action.before).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </details>
    </>
}

type ProposalProps = { ballot: BallotView; canAct: boolean; kinds: ReadonlySet<WeightedWriteKind>; ballotAware: boolean; otherOpen: string[]; allOpenKnown: boolean; submit: (action: WeightedAction) => Promise<void> }
function ProposalEntry({ proposal, ...props }: ProposalProps & { proposal: WeightedPageEntry }) {
    if (isUnreadableProposal(proposal)) return <article className="k-card weighted-dao__proposal" id={`proposal-${proposal.id}`} aria-label={`Proposal ${proposal.id}`}>
        <h3>Unreadable proposal #{proposal.id}</h3>
        <p role="note">{UNREADABLE_PROPOSAL}</p>
    </article>
    return <Proposal proposal={proposal} {...props} />
}

function Proposal({ proposal: p, ballot, canAct, kinds, ballotAware, otherOpen, allOpenKnown, submit }: ProposalProps & { proposal: WeightedProposal }) {
    const [confirming, setConfirming] = useState(false)
    const voteOpen = isVoteOpen(p)
    const pending = isOpenProposal(p)
    // v12 publishes ballots: offer only a choice the realm would record (an
    // eligible voter, a different choice, voting still open).
    const choices = ballotAware ? weightedVoteChoices(p, ballot) : null
    const canVote = (vote: "yes" | "no" | "abstain") => canAct && kinds.has("vote") && voteOpen && (choices === null || choices.has(vote))
    const canExecute = canAct && kinds.has("execute") && p.ready
    const voted = ballot && ballot !== "error" ? ballot.choice : null
    const note = statusNote(p)
    return <article className="k-card weighted-dao__proposal" id={`proposal-${p.id}`} aria-label={`Proposal ${p.id}`}>
        <p className="weighted-dao__eyebrow">#{p.id} · <span className={`weighted-dao__category weighted-dao__category--${p.category}`}>{CATEGORY_TEXT[p.category]}</span></p>
        <ProposalAction action={p.action} />
        <p className="weighted-dao__path">Proposed by: {reveal(p.proposer)}</p>
        <strong>{STATUS_TEXT[p.status]}</strong><p>{tallyText(p)}</p>
        {ballotText(ballot, voteOpen) && <p className="weighted-dao__ballot">{ballotText(ballot, voteOpen)}</p>}
        {ballotAware && voted && voteOpen && <p>You can change your ballot until voting closes. Casting the same choice again changes nothing.</p>}
        {pending && <p className="weighted-dao__warning" role="note">{EXECUTION_INVALIDATES}</p>}
        {note && <p>{note}</p>}
        {proposalTimes(p).map(t => <p key={t.label}>{t.label}: <time dateTime={t.iso}>{t.text}</time></p>)}
        <div className="weighted-dao__actions">
            {(["yes", "no", "abstain"] as const).map(vote => <button key={vote} aria-pressed={ballotAware ? voted === vote : undefined} disabled={!canVote(vote)} onClick={() => void submit({ type: "vote", id: p.id, vote })}>Vote {vote}</button>)}
            <button disabled={!canExecute || confirming} onClick={() => ballotAware ? setConfirming(true) : void submit({ type: "execute", id: p.id })}>Execute proposal</button>
        </div>
        {confirming && <div className="weighted-dao__confirm" role="group" aria-label={`Confirm execution of proposal ${p.id}`}>
            <p className="weighted-dao__warning">{executionWarning(p.id, otherOpen, allOpenKnown)}</p>
            <div className="weighted-dao__actions">
                <button disabled={!canExecute} onClick={() => { setConfirming(false); void submit({ type: "execute", id: p.id }) }}>Confirm execution</button>
                <button onClick={() => setConfirming(false)}>Keep proposals open</button>
            </div>
        </div>}
    </article>
}
