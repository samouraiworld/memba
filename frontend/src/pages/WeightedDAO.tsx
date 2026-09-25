import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useOutletContext, useParams } from "react-router-dom"
import { NETWORKS, GNO_CHAIN_ID, GNO_RPC_URL } from "../lib/config"
import { isUnreadableProposal, readWeightedBallot, validateWeightedRecovery, weightedApplicationPolicies, weightedWritesSupported, weightedWriteKinds, weightedWritesHeld, weightedVoteChoices, weightedAuthority, assertWeightedWrites, assertWeightedPlanSignable, planWeightedTx, readOpenWeightedProposals, readWeightedProposal, readWeightedSnapshot, WEIGHTED_APPLICATIONS_SCHEMA, type WeightedAction, type WeightedConfig, type WeightedBallot, type WeightedContext, type WeightedInvalidation, type WeightedPageEntry, type WeightedProposal, type WeightedWriteKind } from "../lib/dao/weighted"
import { revealInvisibleFormatting as reveal } from "../lib/dao/v2Text"
import { ACCEPT_FUNCS, APPLICATION_LABELS, IMMEDIATE_THRESHOLDS, acceptAdapterFor, applicationDetails, flattenBefore, type ApplicationPolicyKey, type WeightedApplicationAction } from "../lib/dao/weightedApplications"
import { ACCEPTANCE_CONSEQUENCES, ACCEPTANCE_LABELS, ACCEPTANCE_ORDER, AUTHORITY_GETTERS, nextRecommendedAcceptance, acceptanceState, readAcceptanceStates, readTargetAuthority, weightedDaoAddress, type AcceptanceState } from "../lib/dao/weightedAcceptance"
import { v12CallBudget } from "../lib/dao/weightedBudget"
import { WalletNetworkError } from "../lib/walletNetworkGuard"
import { assertLiveWalletChain } from "../lib/dao/weightedWallet"
import { formatUgnotExact } from "../lib/dao/v2Budget"
import { proposalIdFromTxResult } from "../lib/dao/daoTx"
import { doContractBroadcast } from "../lib/grc20"
import type { LayoutContext } from "../types/layout"
import "./weighteddao.css"

type Snapshot = Awaited<ReturnType<typeof readWeightedSnapshot>>
type AcceptanceStates = Partial<Record<ApplicationPolicyKey, AcceptanceState | "error">>
const NO_KINDS: ReadonlySet<WeightedWriteKind> = new Set()
const OPEN_STATUSES = ["VOTING", "TIMELOCKED", "READY"]

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
            if (active.current && ticket === request.current) setError(err instanceof Error && err.name !== "ZodError" ? err.message : "Could not validate weighted governance data. Confirm the realm supports this DAO version, then refresh.")
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
    const openProposals = data && before === "0" ? data.page.proposals.filter((p): p is WeightedProposal => !isUnreadableProposal(p) && OPEN_STATUSES.includes(p.status)) : []
    const submit = async (action: WeightedAction) => {
        if (operation.current || !canAct || !kinds.has(action.type)) return
        operation.current = true; setBusy(true); setError(""); setNotice("")
        const location = window.location.pathname
        const assertCurrent = () => {
            if (!active.current || window.location.pathname !== location || !wallet.connected || !authenticated) throw new Error("Wallet or page changed; prepare the action again")
            assertWeightedWrites(chainId, GNO_CHAIN_ID, wallet.chainId, data?.config.schema ?? "", realmPath, action.type)
            if (rpcUrl !== GNO_RPC_URL) throw new Error("Selected RPC changed")
        }
        // v12: the target must still name the DAO as its pending authority, and no
        // other acceptance may be open anywhere in the history (whichever
        // executes first voids the rest).
        const assertAcceptable = async (snapshot: Snapshot, adapter: ApplicationPolicyKey) => {
            if (snapshot.config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) throw new Error("This DAO has no application adapters")
            const policy = snapshot.config[adapter]
            const open = (await readOpenWeightedProposals(ctx)).find(p => acceptAdapterFor(p.action) !== null)
            assertCurrent()
            if (open) throw new Error(`Acceptance proposal #${open.id} is still open; propose the next acceptance after it executes or closes`)
            const state = acceptanceState(await readTargetAuthority(ctx, adapter, policy.target, policy.successor), weightedDaoAddress(realmPath))
            assertCurrent()
            if (state.kind !== "ready") throw new Error(`${reveal(policy.target)} is not ready for the DAO to accept (${ACCEPTANCE_LABELS[state.kind].toLowerCase()}); refresh before acting`)
        }
        // v12: a ballot is valid only for an eligible voter and a changed choice.
        const assertBallot = async (proposalId: string, vote: "yes" | "no" | "abstain") => {
            const ballot = await readWeightedBallot(ctx, proposalId, wallet.address)
            assertCurrent()
            if (!ballot.eligible) throw new Error("Your address is not eligible to vote on this proposal")
            if (ballot.choice === vote) throw new Error(`You already voted ${vote}; the same ballot again would change nothing`)
        }
        const isV12 = data?.config.schema === WEIGHTED_APPLICATIONS_SCHEMA
        try {
            assertCurrent()
            const fresh = await readWeightedSnapshot(ctx)
            assertCurrent()
            if (data && weightedAuthority(fresh) !== weightedAuthority(data)) throw new Error("DAO roster or roles changed; refresh and review again")
            if (!fresh.members.some(m => m.address === wallet.address)) throw new Error("Only current DAO members can act")
            let executes: WeightedProposal["action"] | undefined
            if (action.type === "recover") {
                validateWeightedRecovery(fresh, action)
            } else if (action.type === "propose") {
                const subject = fresh.members.find(m => m.address === action.target)
                if (!subject || subject[action.role] === action.grant) throw new Error("Select a role change for a current member")
                if (action.role === "admin" && !action.grant && fresh.members.filter(m => m.admin).length === 1) throw new Error("Grant a replacement admin before removing the last admin")
            } else if (action.type === "accept") {
                await assertAcceptable(fresh, action.adapter)
            } else {
                const proposal = await readWeightedProposal(ctx, action.id, fresh.config.schema)
                assertCurrent()
                if (action.type === "execute" ? !proposal.ready : proposal.votingClosed || ["EXECUTED", "INVALIDATED", "EXPIRED"].includes(proposal.status)) throw new Error("Proposal state changed; refresh before acting")
                if (action.type === "vote" && isV12) await assertBallot(action.id, action.vote)
                executes = proposal.action
                // The host refuses an acceptance whose frozen nomination no longer holds.
                const handoff = action.type === "execute" && fresh.config.schema === WEIGHTED_APPLICATIONS_SCHEMA ? acceptAdapterFor(proposal.action) : null
                if (handoff && fresh.config.schema === WEIGHTED_APPLICATIONS_SCHEMA) {
                    const policy = fresh.config[handoff]
                    const state = acceptanceState(await readTargetAuthority(ctx, handoff, policy.target, policy.successor), weightedDaoAddress(realmPath))
                    assertCurrent()
                    const role = AUTHORITY_GETTERS[handoff].authority, target = reveal(policy.target)
                    if (state.kind === "dao") throw new Error(`The DAO already controls ${target}, so this acceptance would fail; refresh before acting`)
                    if (state.kind === "blocked") throw new Error(`${target} would refuse this acceptance: ${state.reasons.join(" ")}`)
                    if (state.kind === "awaiting") throw new Error(`${target} no longer names the DAO as its pending ${role} (pending: ${reveal(state.pending || "none")}), so this acceptance would fail; refresh before acting`)
                }
            }
            const plan = planWeightedTx(wallet.address, realmPath, action, fresh.config.schema, chainId, executes)
            assertWeightedPlanSignable(plan)
            const beforeSign = async () => {
                assertCurrent()
                assertWeightedPlanSignable(plan)
                const current = await readWeightedSnapshot(ctx)
                assertCurrent()
                if (weightedAuthority(current) !== weightedAuthority(fresh)) throw new Error("DAO roster or roles changed during confirmation; review again")
                if (action.type === "recover") validateWeightedRecovery(current, action)
                if (action.type === "accept") await assertAcceptable(current, action.adapter)
                if (action.type === "vote" || action.type === "execute") {
                    const p = await readWeightedProposal(ctx, action.id, current.config.schema)
                    assertCurrent()
                    if (action.type === "execute" ? !p.ready : p.votingClosed || ["EXECUTED", "INVALIDATED", "EXPIRED"].includes(p.status)) throw new Error("Proposal changed during confirmation; refresh")
                    if (action.type === "execute" && JSON.stringify(p.action) !== JSON.stringify(executes)) throw new Error("Proposal changed during confirmation; refresh")
                    if (action.type === "vote" && isV12) await assertBallot(action.id, action.vote)
                }
                // doContractBroadcast runs the shared wallet-network guard before and
                // after these rechecks; v12 adds only the governance hold list.
                if (isV12) { await assertLiveWalletChain({ chainId, address: wallet.address, schema: fresh.config.schema, realmPath }); assertCurrent() }
            }
            const acceptTarget = action.type === "accept" && fresh.config.schema === WEIGHTED_APPLICATIONS_SCHEMA ? fresh.config[action.adapter].target : ""
            const memo = action.type === "recover" ? `Recover ${reveal(action.personId)}: ${action.oldAddress} → ${action.newAddress}. Preserve voting weight and roles.`
                : action.type === "propose" ? `Propose ${action.grant ? "grant" : "removal"} of ${action.role}: ${action.target}`
                : action.type === "accept" ? `Propose that the DAO accepts authority over ${acceptTarget}`
                : `${action.type} weighted proposal ${action.id}`
            const result = await doContractBroadcast([plan.msg], memo, { retry: false, beforeSign, ...(plan.gasWanted !== undefined ? { gasWanted: plan.gasWanted } : {}) })
            assertCurrent()
            if (!/^[a-f0-9]{64}$/i.test(result.hash)) throw new Error("Wallet returned no valid transaction hash; check chain state before trying again")
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
            <p>7 people · 8 voting points. The founder has 2 points; each of the six developers has 1.</p>
            <p>{applications ? "Critical actions (role changes, key recoveries, authority handoffs and appointments)" : "Role changes and supported key recoveries"} require <strong>6 points and at least 4 people, then 24 hours</strong>, or <strong>5 developers, then 72 hours</strong>.</p>
            {applications && <>
                <p>Financial actions (fees, treasury, unpausing, escrow disputes) require <strong>{IMMEDIATE_THRESHOLDS.financial.points} points and at least {IMMEDIATE_THRESHOLDS.financial.people} people</strong> and can execute as soon as they qualify.</p>
                <p>Routine moderation requires <strong>{IMMEDIATE_THRESHOLDS.routine.points} points and at least {IMMEDIATE_THRESHOLDS.routine.people} people</strong> and can execute as soon as it qualifies.</p>
            </>}
            <p>Voting lasts 7 days. Proposals qualified before closing retain their execution delay. {applications ? "Every executed proposal and every emergency pause invalidates all other outstanding proposals." : "Every executed role or key change invalidates other outstanding proposals."}</p>
            <p>Admin and finance labels do not add voting power or exclusive execution rights.</p>
        </section>
        {data && held && <p role="status">Mainnet governance is read-only for this DAO in Memba.</p>}
        <p>{applications ? "Fixed application actions are available for the adapters below. Migration and treasury spending are not." : "Migration, treasury spending and application actions are not available in this DAO version."}</p>
        <button disabled={loading || busy} onClick={() => void refresh("0")}>Refresh chain state</button>
        {loading && <p role="status">Reading governance state…</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status" className="weighted-dao__path">{notice}</p>}
        {data && <>
            <section aria-labelledby="weighted-members"><h2 id="weighted-members">Members and roles</h2><ul className="weighted-dao__members">{data.members.map(m => <li className="k-card" key={m.address}>
                <strong>{reveal(m.personId)}</strong><span>{m.founder ? "Founder" : "Core developer"} · {m.weight} {m.weight === 1 ? "point" : "points"}</span>
                <code>{reveal(m.address)}</code><span>{[m.admin && "Admin", m.finance && "Finance"].filter(Boolean).join(" · ") || "No admin or finance role"}</span>
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
                {data.page.proposals.map(p => <ProposalEntry key={p.id} proposal={p} ballot={ballots[p.id]} canAct={canAct} kinds={kinds} ballotAware={applications} otherOpen={openProposals.filter(o => o.id !== p.id).map(o => o.id)} newestPage={before === "0"} submit={submit} />)}
                <div className="weighted-dao__actions">{before !== "0" && <button disabled={loading || busy} onClick={() => void refresh("0")}>Newest proposals</button>}{data.page.nextBefore && <button disabled={loading || busy} onClick={() => void refresh(data.page.nextBefore!)}>Older proposals</button>}</div>
            </section>
        </>}
    </div>
}

const POLICY_NOTES: Partial<Record<ApplicationPolicyKey, string>> = {
    reviewsPolicy: "Moderator handoffs are critical; hiding and unhiding items is routine.",
    marketPolicy: "Admin handoffs are critical; fees and the treasury are financial.",
}
const CATEGORY_KEYS = ["signerCategory", "attesterCategory", "curatorCategory", "sealCategory", "moderationCategory", "unpauseCategory", "resolutionCategory", "adminCategory", "moderatorCategory", "memberCategory"] as const

function ApplicationPolicies({ config, acceptance, canAccept, eligible, held, openProposals, submit }: { config: WeightedConfig; acceptance: AcceptanceStates; canAccept: boolean; eligible: boolean; held: boolean; openProposals: WeightedProposal[]; submit: (action: WeightedAction) => Promise<void> }) {
    const openAccept = openProposals.find(p => acceptAdapterFor(p.action) !== null)
    const policies = new Map(weightedApplicationPolicies(config).map(({ key, policy }) => [key, policy]))
    const next = nextRecommendedAcceptance(acceptance)
    return <section aria-labelledby="weighted-adapters"><h2 id="weighted-adapters">Application adapters</h2>
        <p>Each adapter governs one fixed realm. A return proposal only stages the configured successor, who must accept separately.</p>
        <div className="k-card weighted-dao__handoff" aria-labelledby="weighted-handoff">
            <h3 id="weighted-handoff">Handing a target over to the DAO</h3>
            <p>The publisher first nominates the DAO as the target's pending owner. Then each acceptance is a critical proposal:</p>
            <ol>
                <li>Any member proposes the acceptance.</li>
                <li>At least 4 people with 6 points vote yes, then 24 hours pass. Or 5 core developers vote yes, then 72 hours pass.</li>
                <li>Any member executes it. The page then reads the target again to confirm the DAO controls it.</li>
            </ol>
            <p>Voting closes after 7 days; a proposal that qualified before that keeps its delay.</p>
            <p className="weighted-dao__warning" role="note">One open acceptance at a time: executing any application action invalidates every other open proposal. Propose the next acceptance only after the previous one has executed, in the numbered order below.</p>
        </div>
        {held && <p>Acceptance proposals stay disabled on mainnet until the governance write hold is lifted.</p>}
        <ol className="weighted-dao__adapters">{ACCEPTANCE_ORDER.map((key, index) => {
            const policy = policies.get(key)
            if (!policy) return null
            return <li className={`k-card${key === next ? " weighted-dao__adapter--next" : ""}`} key={key} aria-label={`${key} adapter`}>
                <p className="weighted-dao__eyebrow">Handoff {index + 1} of {ACCEPTANCE_ORDER.length}{key === next && <> · <strong className="weighted-dao__next">Next recommended</strong></>}</p>
                <h3>{POLICY_LABELS[key]}</h3>
                <p className="weighted-dao__path">Target: {reveal(policy.target)}</p>
                <p className="weighted-dao__path">Successor: {reveal(policy.successor)}</p>
                {"treasury" in policy && <p className="weighted-dao__path">Treasury: {reveal(policy.treasury)}</p>}
                {"maxRegistrationFee" in policy && <p>Maximum registration fee: {reveal(policy.maxRegistrationFee)} ugnot</p>}
                <p>{CATEGORY_KEYS.filter(k => k in policy).map(k => `${k.replace(/Category$/, "")}: ${(policy as Record<string, unknown>)[k]}`).join(" · ") || POLICY_NOTES[key]}</p>
                {"emergencyPause" in policy && <p>Any current member can pause it immediately; unpausing needs a financial vote.</p>}
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
        {state.kind === "dao" && <p className="weighted-dao__path">The DAO is the current {role}.{state.pending ? ` A return to ${reveal(state.pending)} is staged.` : ""}</p>}
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
const POLICY_LABELS: Record<ApplicationPolicyKey, string> = {
    marketPolicy: APPLICATION_LABELS["market-config"], reviewsPolicy: APPLICATION_LABELS.reviews, questPolicy: APPLICATION_LABELS.quest, arcadePolicy: APPLICATION_LABELS.arcade,
    appstorePolicy: APPLICATION_LABELS.appstore, escrowPolicy: APPLICATION_LABELS.escrow, badgesPolicy: APPLICATION_LABELS.badges, feedPolicy: APPLICATION_LABELS.feed,
    channelsPolicy: APPLICATION_LABELS.channels, feedbackPolicy: APPLICATION_LABELS.feedback,
}
const CATEGORY_TEXT = { routine: "Routine", financial: "Financial", critical: "Critical" } as const

function ProposalAction({ action }: { action: WeightedProposal["action"] }) {
    if (action.type === "set-role") return <><h3>{action.grant ? "Grant" : "Remove"} {action.role}</h3><p className="weighted-dao__path">Target: {reveal(action.target)}</p></>
    if (action.type === "recover-member") return <><h3>Recover member key</h3><p>Person: {reveal(action.personId)}</p><p className="weighted-dao__path">Old address: {reveal(action.oldAddress)}</p><p className="weighted-dao__path">Replacement address: {reveal(action.newAddress)}</p><p>Identity, voting weight and roles are preserved.</p></>
    return <ApplicationAction action={action} />
}

function ApplicationAction({ action }: { action: WeightedApplicationAction }) {
    const details = applicationDetails(action)
    return <>
        <h3>{APPLICATION_LABELS[action.type]} · {action.operation}</h3>
        <p className="weighted-dao__path">Target realm: {reveal(action.target)}</p>
        {details.length > 0 && <dl className="weighted-dao__facts">{details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        <details className="weighted-dao__before"><summary>State frozen at proposal time</summary>
            <p>Execution is refused if the target realm no longer matches this state.</p>
            <dl className="weighted-dao__facts">{flattenBefore(action.before).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </details>
    </>
}

type BallotView = WeightedBallot | "error" | undefined
type ProposalProps = { ballot: BallotView; canAct: boolean; kinds: ReadonlySet<WeightedWriteKind>; ballotAware: boolean; otherOpen: string[]; newestPage: boolean; submit: (action: WeightedAction) => Promise<void> }
function ProposalEntry({ proposal, ...props }: ProposalProps & { proposal: WeightedPageEntry }) {
    if (isUnreadableProposal(proposal)) return <article className="k-card weighted-dao__proposal" id={`proposal-${proposal.id}`} aria-label={`Proposal ${proposal.id}`}>
        <h3>Unreadable proposal #{proposal.id}</h3>
        <p role="note">Memba could not validate this proposal against the DAO contract, so it is not shown and cannot be acted on here. Other proposals are unaffected.</p>
    </article>
    return <Proposal proposal={proposal} {...props} />
}

function ballotText(ballot: BallotView, open: boolean): string | null {
    if (ballot === undefined) return null
    if (ballot === "error") return "Your ballot could not be read."
    if (!ballot.eligible) return "Your address is not eligible to vote on this proposal."
    if (ballot.choice) return `You voted ${ballot.choice} (block ${ballot.votedAtHeight}).`
    return open ? "You have not voted." : "You did not vote."
}

function invalidationText(v: WeightedInvalidation): string {
    if (v.cause === "pause") return `Invalidated at block ${v.height}: a member paused ${reveal(v.target ?? "an application")}.`
    return `Invalidated at block ${v.height}: proposal #${v.proposalId} executed${v.target ? ` (${reveal(v.target)})` : ""}.`
}

function Proposal({ proposal: p, ballot, canAct, kinds, ballotAware, otherOpen, newestPage, submit }: ProposalProps & { proposal: WeightedProposal }) {
    const [confirming, setConfirming] = useState(false)
    const voteOpen = !p.votingClosed && !["EXECUTED", "INVALIDATED", "EXPIRED"].includes(p.status)
    const pending = ["VOTING", "TIMELOCKED", "READY"].includes(p.status)
    // v12 publishes ballots: offer only a choice the realm would record (an
    // eligible voter, a different choice, voting still open).
    const choices = ballotAware ? weightedVoteChoices(p, ballot) : null
    const canVote = (vote: "yes" | "no" | "abstain") => canAct && kinds.has("vote") && voteOpen && (choices === null || choices.has(vote))
    const canExecute = canAct && kinds.has("execute") && p.ready
    const voted = ballot && ballot !== "error" ? ballot.choice : null
    return <article className="k-card weighted-dao__proposal" id={`proposal-${p.id}`} aria-label={`Proposal ${p.id}`}>
        <p className="weighted-dao__eyebrow">#{p.id} · <span className={`weighted-dao__category weighted-dao__category--${p.category}`}>{CATEGORY_TEXT[p.category]}</span></p>
        <ProposalAction action={p.action} />
        <p className="weighted-dao__path">Proposed by: {reveal(p.proposer)}</p>
        <strong>{p.status}</strong><p>{p.talliesAvailable ? `${p.weightYes} ${p.weightYes === 1 ? "point" : "points"} · ${p.peopleYes} ${p.peopleYes === 1 ? "person" : "people"} · ${p.developersYes} ${p.developersYes === 1 ? "developer" : "developers"} voting yes` : "Historical vote totals are unavailable."}</p>
        {p.status === "INVALIDATED" && <p>{p.invalidation ? invalidationText(p.invalidation) : "Invalidated: another proposal executed, or an emergency pause ran, after this was proposed."}</p>}
        {ballotText(ballot, voteOpen) && <p className="weighted-dao__ballot">{ballotText(ballot, voteOpen)}</p>}
        {ballotAware && voted && voteOpen && <p>You can change your ballot until voting closes. Casting the same choice again changes nothing.</p>}
        {pending && <p className="weighted-dao__warning" role="note">Executing this proposal invalidates every other outstanding proposal.</p>}
        {p.category !== "critical" && p.status === "READY" && <p>{CATEGORY_TEXT[p.category]} proposals can execute as soon as they qualify.</p>}
        {p.status === "TIMELOCKED" && <p>Qualified. Execution opens when a route below matures.</p>}
        <p>Voting closes: <time dateTime={p.votingDeadline}>{p.votingDeadline}</time>{p.votingClosed ? " (closed)" : ""}</p>
        {p.weightedAfter && <p>Weighted route matures: <time dateTime={p.weightedAfter}>{p.weightedAfter}</time></p>}
        {p.developerAfter && <p>Developer route matures: <time dateTime={p.developerAfter}>{p.developerAfter}</time></p>}
        <div className="weighted-dao__actions">
            {(["yes", "no", "abstain"] as const).map(vote => <button key={vote} aria-pressed={ballotAware ? voted === vote : undefined} disabled={!canVote(vote)} onClick={() => void submit({ type: "vote", id: p.id, vote })}>Vote {vote}</button>)}
            <button disabled={!canExecute || confirming} onClick={() => ballotAware ? setConfirming(true) : void submit({ type: "execute", id: p.id })}>Execute proposal</button>
        </div>
        {confirming && <div className="weighted-dao__confirm" role="group" aria-label={`Confirm execution of proposal ${p.id}`}>
            <p className="weighted-dao__warning">{otherOpen.length
                ? `Executing #${p.id} invalidates ${otherOpen.length === 1 ? "open proposal" : `${otherOpen.length} open proposals`} ${otherOpen.map(id => `#${id}`).join(", ")}${newestPage ? "" : " and any other open proposal"}. They cannot be revived; their proposers would need to propose again.`
                : `Executing #${p.id} invalidates every other open proposal.`}</p>
            <div className="weighted-dao__actions">
                <button disabled={!canExecute} onClick={() => { setConfirming(false); void submit({ type: "execute", id: p.id }) }}>Confirm execution</button>
                <button onClick={() => setConfirming(false)}>Keep proposals open</button>
            </div>
        </div>}
    </article>
}
