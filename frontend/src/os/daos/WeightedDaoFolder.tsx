/**
 * A weighted DAO (the governing Memba DAO) in its DAO folder window: how it
 * decides, its seats, its proposals, the applications it governs and where
 * their fees go. It reads the DAO through its own versioned contract
 * (lib/dao/weighted), never through the equal-headcount loaders the other DAO
 * kinds use.
 *
 * A seat holder votes and executes in each proposal's window, and proposes
 * that the DAO accepts an application from the Overview, each through the
 * Memba OS signing sheet. Older contract versions are read-only here.
 *
 * @module os/daos/WeightedDaoFolder
 */
import { useEffect, useRef, useState } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { revealInvisibleFormatting as reveal } from "../../lib/dao/v2Text"
import { isUnreadableProposal, WEIGHTED_APPLICATIONS_SCHEMA, weightedProposalTitle, weightedWritesHeld, type WeightedProposal, type WeightedSnapshot, type WeightedV12Config } from "../../lib/dao/weighted"
import { ACCEPTANCE_CONSEQUENCES, ACCEPTANCE_LABELS, ACCEPTANCE_ORDER, AUTHORITY_GETTERS, acceptAdapterFor, nextRecommendedAcceptance, weightedDaoAddress, type AcceptanceState } from "../../lib/dao/weightedAcceptance"
import { teamWallet, type FeeDestination } from "../../lib/dao/weightedTreasury"
import { CATEGORY_TEXT, POLICY_LABELS, UNREADABLE_PROPOSAL, applicationRules, decisionRules, invalidationRule, isOpenProposal, openProposalsOf, roleText, seatText, seatsRule, tallyText, votingRule, weightedDaoTitle, weightedReadError, ROLES_ADD_NOTHING, seatsSummary } from "../../lib/dao/weightedView"
import { clearGovernanceReceipt, governanceRequestActive, type GovernanceScope } from "../../lib/dao/governanceRecovery"
import { weightedAcceptLock, weightedTreasuryLock } from "../../lib/dao/weightedActions"
import { treasuryAdapterFor, type ApplicationPolicyKey } from "../../lib/dao/weightedApplications"
import { ErrorState, Loading, Pill, type PillTone } from "../kit"
import { shortAddr } from "../shell/format"
import { ThingTile } from "../shell/icons"
import type { DaoSection } from "../shell/osPath"
import type { OsSession } from "../shell/useOsSession"
import { daoSpec, specForTarget, type WindowSpec } from "../shell/windows"
import { formatUgnot } from "../wallet/send"
import { useSigner } from "../sign/signerContext"
import { UnknownOutcome } from "./UnknownOutcome"
import { StatusPill, WeightedHold } from "./WeightedProposal"
import { quoteWeightedGasPrice, weightedAcceptRequest, weightedTreasuryRequest } from "./weightedRequest"
import { useAcceptanceStates, useFeeDestinations, useRefreshWeightedDao, useWeightedBalance, useWeightedSnapshot } from "./useWeightedDao"

interface FolderProps { name: string; realmPath: string; section: DaoSection; open: (spec: WindowSpec) => void; session: OsSession }

export function WeightedDaoFolder(props: FolderProps) {
    const { realmPath, section, session } = props
    const snapshot = useWeightedSnapshot(realmPath)
    const signer = useSigner()
    const refresh = useRefreshWeightedDao(realmPath)
    // After a signature settles, read the DAO again: an acceptance proposed here shows at once. Only a new one: the folder
    // remounts when its sections change.
    const seen = useRef(signer.version)
    useEffect(() => {
        if (signer.version === seen.current) return
        seen.current = signer.version
        void refresh()
    }, [signer.version, refresh])
    const data = snapshot.data
    if (!data) return snapshot.isError ? <ErrorState message={weightedReadError(snapshot.error)} onRetry={() => void snapshot.refetch()} /> : <Loading label="Reading governance state…" />
    return (
        <>
            {/* A later read that fails leaves the previous one on screen, and says so. */}
            {snapshot.isError && <ErrorState message={`${weightedReadError(snapshot.error)} This is the previous read.`} onRetry={() => void snapshot.refetch()} />}
            {section === "proposals" ? <Proposals {...props} newest={data} />
                : section === "members" ? <Members data={data} session={session} />
                    : section === "treasury" ? <Treasury realmPath={realmPath} name={props.name} data={data} session={session} />
                        : <Overview {...props} data={data} />}
        </>
    )
}

/** What the connected account is to this DAO; a guest gets nothing here (the desk already says "guest"). */
function Seat({ data, session }: { data: WeightedSnapshot; session: OsSession }) {
    if (session.status !== "member") return null
    const me = data.members.find((m) => m.address === session.address)
    return me
        ? <p className="os-note">Your seat: <b>{reveal(me.personId)}</b> · {seatText(me)} · {roleText(me)}</p>
        : <p className="os-note">Your address holds none of the {data.config.rosterSize} seats: you can read this DAO, but only seat holders propose, vote and execute.</p>
}

const openOf = (data: WeightedSnapshot) => data.page.proposals.filter((p): p is WeightedProposal => !isUnreadableProposal(p) && isOpenProposal(p))

function ProposalRow({ p, name, open }: { p: WeightedProposal; name: string; open: (spec: WindowSpec) => void }) {
    return (
        <button type="button" className="os-it os-click" onClick={() => open(specForTarget({ kind: "proposal", dao: name, n: Number(p.id) })!)}>
            <ThingTile icon="doc" size={28} />
            <span className="os-grow"><b>#{p.id} {weightedProposalTitle(p)}</b><span className="os-sub os-block">{CATEGORY_TEXT[p.category]} · {tallyText(p)}</span></span>
            <StatusPill status={p.status} />
        </button>
    )
}

/** How many readable proposals are open, over which proposals, and how many could not be read (whether those are open is unknown). */
function openSummary(data: WeightedSnapshot, open: number): string {
    const { proposals, total, nextBefore } = data.page
    const unreadable = proposals.filter(isUnreadableProposal).length
    const over = nextBefore === null ? `all ${total} proposals` : `the latest ${proposals.length} proposals`
    if (!unreadable) return `${open ? `${open} open` : "None open"} among ${over}.`
    return `${open ? `${open} readable ${open === 1 ? "proposal is" : "proposals are"} open` : "No readable proposal is open"}; ${unreadable} of ${over} could not be read.`
}

function Overview({ name, realmPath, data, open, session }: FolderProps & { data: WeightedSnapshot }) {
    const { config } = data
    const openNow = openOf(data)
    return (
        <div className="os-stack">
            <div>
                <div className="os-holding-title">{weightedDaoTitle(realmPath, name)}</div>
                <p className="os-sub os-mono os-break os-flush">{realmPath}</p>
                <p className="os-sub os-flush">{seatsSummary(config)} · {GNO_CHAIN_ID}</p>
            </div>
            {weightedWritesHeld(GNO_CHAIN_ID, config.schema, realmPath) && <WeightedHold />}
            <Seat data={data} session={session} />
            <section>
                <h3 className="os-h">How decisions pass</h3>
                <ul className="os-list">{decisionRules(config).map((rule) => (
                    <li key={rule.category} className="os-it os-top">
                        <span className="os-grow">
                            <b>{CATEGORY_TEXT[rule.category]}</b><span className="os-sub os-block">{rule.covers.charAt(0).toUpperCase() + rule.covers.slice(1)}</span>
                            {rule.routes.map((route, i) => <span key={route} className="os-block">{i > 0 && "or "}{route}{!rule.delayed && ", with no delay"}</span>)}
                        </span>
                    </li>
                ))}</ul>
                <p className="os-sub">
                    {seatsRule(config)} {votingRule(config)} {invalidationRule(config)}
                </p>
            </section>
            <section>
                <h3 className="os-h">Open proposals</h3>
                <p className="os-sub">{data.page.total === "0" ? "None: the DAO has recorded no proposal yet." : `${openSummary(data, openNow.length)}${openNow.length > 3 ? " The newest three:" : ""}`}</p>
                {openNow.length > 0 && <ul className="os-list">{openNow.slice(0, 3).map((p) => <li key={p.id}><ProposalRow p={p} name={name} open={open} /></li>)}</ul>}
                {(openNow.length > 3 || data.page.nextBefore !== null) && (
                    <button type="button" className="os-btn os-quiet" onClick={() => open(daoSpec(name, "proposals"))}>All {data.page.total} proposals</button>
                )}
            </section>
            {config.schema === WEIGHTED_APPLICATIONS_SCHEMA && <Applications realmPath={realmPath} name={name} data={data} config={config} session={session} />}
        </div>
    )
}

const STATE_TONE: Record<AcceptanceState["kind"], PillTone | undefined> = { dao: "ok", ready: undefined, blocked: "err", awaiting: "neutral" }

interface ApplicationsProps { realmPath: string; name: string; data: WeightedSnapshot; config: WeightedV12Config; session: OsSession }

function Applications({ realmPath, name, data, config, session }: ApplicationsProps) {
    const acceptance = useAcceptanceStates(realmPath, config)
    // Only one acceptance may be open: the one open among the newest proposals, if any.
    const openAcceptance = openProposalsOf(data.page).open.find((p) => acceptAdapterFor(p.action) !== null)
    const states = acceptance.data ?? {}
    const read = ACCEPTANCE_ORDER.map((key) => states[key]).filter((s): s is AcceptanceState => s !== undefined && s !== "error")
    const total = ACCEPTANCE_ORDER.length
    return (
        <section>
            <h3 className="os-h">Applications the DAO governs</h3>
            <p className="os-sub">
                Each application is handed over in two steps: its publisher nominates the DAO, then the DAO accepts by a critical vote. Memba offers one acceptance at a time: executing any proposal invalidates the others.
                {/* A count is a claim about all of them: none is made from a partial read. */}
                {acceptance.data && (read.length === total ? ` The DAO controls ${read.filter((s) => s.kind === "dao").length} of ${total} today.` : ` ${total - read.length} of ${total} could not be read.`)}
            </p>
            {/* A later read that fails leaves the previous one on screen, and says so. */}
            {acceptance.isError && <ErrorState message={acceptance.data ? "The applications' current owners could not be read again. This is the previous read." : "The applications' current owners could not be read."} onRetry={() => void acceptance.refetch()} />}
            {/* The attempt landed only if the open acceptance is this member's own (verify's proof). */}
            <AcceptanceLock realmPath={realmPath} session={session} landed={!!openAcceptance && openAcceptance.proposer === session.address} />
            <ol className="os-list">{ACCEPTANCE_ORDER.map((key) => {
                const state = states[key]
                const known = state !== undefined && state !== "error" ? state : null
                const role = AUTHORITY_GETTERS[key].authority
                return (
                    <li key={key} className="os-it os-top" aria-label={POLICY_LABELS[key]}>
                        <div className="os-grow">
                            <b>{POLICY_LABELS[key]}</b>{key === nextRecommendedAcceptance(states) && <span className="os-sub"> · next in the recommended order</span>}
                            <span className="os-sub os-block os-mono">{reveal(config[key].target)}</span>
                            {known && known.kind !== "dao" && (
                                <span className="os-sub os-block">
                                    Current {role}: <span className="os-mono">{known.current ? shortAddr(known.current) : "none"}</span>
                                    {known.kind === "awaiting" && <> · nominated: {known.pending ? <span className="os-mono">{shortAddr(known.pending)}</span> : "nobody yet"}</>}
                                </span>
                            )}
                            {known?.kind === "dao" && known.pending && <span className="os-sub os-block">A handover back to <span className="os-mono">{shortAddr(known.pending)}</span> is pending.</span>}
                            {known?.kind === "blocked" && known.reasons.map((reason) => <span key={reason} className="os-sub os-block">{reason}</span>)}
                            {known?.kind === "ready" && <span className="os-sub os-block">{ACCEPTANCE_CONSEQUENCES[key]}</span>}
                            {known?.kind === "ready" && <ProposeAcceptance adapter={key} realmPath={realmPath} name={name} data={data} session={session} openAcceptance={openAcceptance} />}
                            <details className="os-sub">
                                <summary>Its rules</summary>
                                {applicationRules(key, config[key]).map((rule) => <span key={rule} className="os-block">{rule}</span>)}
                            </details>
                        </div>
                        {known ? <Pill tone={STATE_TONE[known.kind]}>{ACCEPTANCE_LABELS[known.kind]}</Pill>
                            : state === "error" || acceptance.isError ? <Pill tone="warn">Not readable</Pill>
                                : <span className="os-sub" role="status">Reading…</span>}
                    </li>
                )
            })}</ol>
        </section>
    )
}

/**
 * An acceptance attempt with an unknown outcome locks proposing another until
 * the member checks it. Once an acceptance is open on chain, the one-open rule
 * holds anyway, so the lock is moot and cleared.
 */
function AcceptanceLock({ realmPath, session, landed }: { realmPath: string; session: OsSession; landed: boolean }) {
    const [, rerender] = useState(0)
    const lock = session.status === "member" ? weightedAcceptLock(GNO_CHAIN_ID, realmPath, session.address) : null
    const mootKey = landed && lock ? JSON.stringify(lock) : ""
    useEffect(() => {
        if (!mootKey) return
        try { clearGovernanceReceipt((JSON.parse(mootKey) as { scope: GovernanceScope }).scope) } catch { return /* its request is still in flight */ }
        // The receipt lives in browser storage, outside React: read it again once cleared.
        queueMicrotask(() => rerender((x) => x + 1))
    }, [mootKey])
    if (!lock) return null
    if (governanceRequestActive(lock.scope)) return <p className="os-sub" role="status">Waiting for the wallet…</p>
    return <UnknownOutcome key={JSON.stringify(lock.scope)} scope={lock.scope} receipt={lock.receipt} attempt="proposal" again="proposing an acceptance again" onCleared={() => rerender((x) => x + 1)} />
}

/** A seat holder proposes that the DAO accepts an application it has been nominated for; a guest is asked to connect here. */
function ProposeAcceptance({ adapter, realmPath, name, data, session, openAcceptance }: { adapter: ApplicationPolicyKey; realmPath: string; name: string; data: WeightedSnapshot; session: OsSession; openAcceptance?: WeightedProposal }) {
    const signer = useSigner()
    const [failed, setFailed] = useState<string | null>(null)
    // Said to everyone, on a held DAO too: while one acceptance is open, Memba offers no other (and this one may be it).
    if (openAcceptance) {
        return <span className="os-sub os-block">{acceptAdapterFor(openAcceptance.action) === adapter
            ? `Acceptance proposal #${openAcceptance.id} for this application is open.`
            : `Acceptance proposal #${openAcceptance.id} is open: propose this one after it executes or closes.`}</span>
    }
    if (weightedWritesHeld(GNO_CHAIN_ID, data.config.schema, realmPath)) return null
    if (session.status === "resuming") return null
    if (session.status === "guest") return <button type="button" className="os-btn os-quiet" onClick={session.openConnect}>Connect to propose</button>
    if (!data.members.some((m) => m.address === session.address) || weightedAcceptLock(GNO_CHAIN_ID, realmPath, session.address)) return null
    const review = async () => {
        setFailed(null)
        try { signer.sign(weightedAcceptRequest({ realmPath, daoName: weightedDaoTitle(realmPath, name), snapshot: data, caller: session.address, gasPrice: await quoteWeightedGasPrice() }, adapter)) }
        catch (err) { setFailed(err instanceof Error ? err.message : String(err)) }
    }
    return (
        <>
            <button type="button" className="os-btn os-quiet" onClick={() => void review()}>Propose acceptance…</button>
            {failed && <span className="os-note os-warn os-block" role="alert">{failed}</span>}
        </>
    )
}

/**
 * A seat holder proposes the financial vote that moves an application's fees to
 * the treasury the DAO's policy names. It fails closed, saying why, while the
 * DAO does not control the application, a handover is pending, or one is open;
 * with no treasury set, or the fees already there, it offers nothing.
 */
function ProposeTreasury({ fees, realmPath, name, data, config, session }: { fees: FeeDestination; realmPath: string; name: string; data: WeightedSnapshot; config: WeightedV12Config; session: OsSession }) {
    const signer = useSigner()
    // Read only while the fees could still move: a row already paying the policy's treasury only clears a moot lock.
    const acceptance = useAcceptanceStates(realmPath, config, !!fees.current && fees.current !== fees.policyTreasury)
    const [failed, setFailed] = useState<string | null>(null)
    const [, rerender] = useState(0)
    const adapter = fees.key
    const label = POLICY_LABELS[adapter]
    const open = openProposalsOf(data.page).open.find((p) => treasuryAdapterFor(p.action) === adapter)
    const lock = session.status === "member" ? weightedTreasuryLock(GNO_CHAIN_ID, realmPath, session.address, adapter) : null
    // The attempt landed (this member's proposal is open) or the fees moved: the lock is moot.
    const mootKey = lock && ((open && open.proposer === session.address) || fees.current === fees.policyTreasury) ? JSON.stringify(lock.scope) : ""
    useEffect(() => {
        if (!mootKey) return
        try { clearGovernanceReceipt(JSON.parse(mootKey) as GovernanceScope) } catch { return /* its request is still in flight */ }
        // The receipt lives in browser storage, outside React: read it again once cleared.
        queueMicrotask(() => rerender((x) => x + 1))
    }, [mootKey])
    const paidToday = fees.current
    if (!paidToday || paidToday === fees.policyTreasury) return null
    if (open) return <span className="os-sub os-block">Proposal #{open.id} to move these fees is open.</span>
    if (weightedWritesHeld(GNO_CHAIN_ID, config.schema, realmPath)) return null
    const state = acceptance.data?.[adapter]
    if (state === undefined || state === "error") return acceptance.isError || state === "error" ? <span className="os-sub os-block">Whether the DAO controls {label} could not be read.</span> : null
    if (state.kind !== "dao") return <span className="os-sub os-block">A seat holder can propose this only while the DAO controls {label}.</span>
    if (state.pending) return <span className="os-sub os-block">A handover of {label} back to its publisher is pending: a seat holder can propose this only if the DAO cancels it.</span>
    if (session.status === "resuming") return null
    if (session.status === "guest") return <button type="button" className="os-btn os-quiet" onClick={session.openConnect}>Connect to propose</button>
    if (!data.members.some((m) => m.address === session.address)) return null
    if (lock) {
        if (governanceRequestActive(lock.scope)) return <span className="os-sub os-block" role="status">Waiting for the wallet…</span>
        return <UnknownOutcome key={JSON.stringify(lock.scope)} scope={lock.scope} receipt={lock.receipt} attempt="proposal" again="proposing to move these fees again" onCleared={() => rerender((x) => x + 1)} />
    }
    const review = async () => {
        setFailed(null)
        try { signer.sign(weightedTreasuryRequest({ realmPath, daoName: weightedDaoTitle(realmPath, name), snapshot: data, caller: session.address, gasPrice: await quoteWeightedGasPrice() }, adapter, paidToday)) }
        catch (err) { setFailed(err instanceof Error ? err.message : String(err)) }
    }
    return (
        <>
            <button type="button" className="os-btn os-quiet" onClick={() => void review()}>Propose moving these fees…</button>
            {failed && <span className="os-note os-warn os-block" role="alert">{failed}</span>}
        </>
    )
}

function Proposals({ name, realmPath, open, session, newest }: FolderProps & { newest: WeightedSnapshot }) {
    const [before, setBefore] = useState("0")
    const older = useWeightedSnapshot(realmPath, before, before !== "0")
    const page = before === "0" ? newest : older.data
    const held = weightedWritesHeld(GNO_CHAIN_ID, newest.config.schema, realmPath)
    const seat = newest.members.some((m) => m.address === session.address)
    return (
        <div className="os-stack os-tight">
            {/* Acting is in each proposal's window (vote, execute) and in the Overview's applications (propose): each asks a guest to connect there. */}
            <span className="os-sub">{newest.page.total} {newest.page.total === "1" ? "proposal" : "proposals"} recorded</span>
            {held && <WeightedHold />}
            {!seat && <Seat data={newest} session={session} />}
            {/* The newest page's failed re-read is said above the sections; an older page's is said here. */}
            {before !== "0" && older.isError && older.data && <ErrorState message={`${weightedReadError(older.error)} This is the previous read.`} onRetry={() => void older.refetch()} />}
            {!page ? (older.isError ? <ErrorState message={weightedReadError(older.error)} onRetry={() => void older.refetch()} /> : <Loading label="Loading older proposals…" />)
                : page.page.proposals.length === 0 ? <p className="os-sub">No proposals yet.</p>
                    : <ul className="os-list">{page.page.proposals.map((p) => (
                        <li key={p.id}>{isUnreadableProposal(p)
                            ? <div className="os-it"><ThingTile icon="doc" size={28} /><span className="os-grow"><b>Unreadable proposal #{p.id}</b><span className="os-sub os-block">{UNREADABLE_PROPOSAL}</span></span></div>
                            : <ProposalRow p={p} name={name} open={open} />}
                        </li>
                    ))}</ul>}
            <div className="os-row">
                {before !== "0" && <button type="button" className="os-btn os-quiet" onClick={() => setBefore("0")}>Newest proposals</button>}
                {page?.page.nextBefore && <button type="button" className="os-btn os-quiet" onClick={() => setBefore(page.page.nextBefore!)}>Older proposals</button>}
            </div>
        </div>
    )
}

function Members({ data, session }: { data: WeightedSnapshot; session: OsSession }) {
    const { config } = data
    return (
        <div className="os-stack os-tight">
            <Seat data={data} session={session} />
            <ul className="os-list">{data.members.map((m) => (
                <li key={m.address} className="os-it">
                    <span className="os-av" aria-hidden="true">{reveal(m.personId).slice(0, 1).toUpperCase()}</span>
                    <span className="os-grow"><b>{reveal(m.personId)}</b><span className="os-sub os-block os-mono">{m.address}</span></span>
                    <span className="os-sub os-right">{seatText(m)}<span className="os-block">{roleText(m)}</span></span>
                </li>
            ))}</ul>
            <p className="os-sub">
                The DAO has exactly {config.rosterSize} seats and {config.totalPoints} voting points. It cannot admit or remove a member
                {config.capabilities.memberReplacement ? "; a critical vote can only move a seat to a new address of the same person" : ""}.
                {ROLES_ADD_NOTHING}
            </p>
        </div>
    )
}

/** A balance as read; a failed first read offers a retry, a failed re-read keeps the previous one and says so. */
function Held({ balance }: { balance: ReturnType<typeof useWeightedBalance> }) {
    if (balance.data === undefined) {
        return balance.isError
            ? <>Could not be read <button type="button" className="os-btn os-quiet" onClick={() => void balance.refetch()}>Retry</button></>
            : <span role="status">Reading…</span>
    }
    return <>{formatUgnot(balance.data)}{balance.isError && <span className="os-sub os-block">Previous read: the latest could not be read.</span>}</>
}

function Wallet({ realmPath, address }: { realmPath: string; address: string }) {
    const balance = useWeightedBalance(realmPath, address)
    const wallet = teamWallet(address)
    return (
        <li className="os-it os-top">
            <span className="os-grow">
                <b>{wallet?.name ?? "Wallet"}</b>
                <span className="os-sub os-block os-mono">{address}</span>
                {wallet && <span className="os-sub os-block">The team declares it {wallet.declared}.</span>}
            </span>
            <span className="os-right">
                <Held balance={balance} />
            </span>
        </li>
    )
}

function Treasury({ realmPath, name, data, session }: { realmPath: string; name: string; data: WeightedSnapshot; session: OsSession }) {
    const dao = weightedDaoAddress(realmPath)
    const own = useWeightedBalance(realmPath, dao)
    const { config } = data
    return (
        <div className="os-stack">
            <div className="os-card os-stack os-tight">
                <b>This DAO has no treasury and cannot spend funds</b>
                <p className="os-sub os-flush">
                    {config.schema === WEIGHTED_APPLICATIONS_SCHEMA
                        ? <>For the applications it controls, it votes on their fees and on the wallets those fees are paid to; no vote can pay the DAO itself.
                            Its financial votes also settle Escrow disputes between a contract's client and freelancer.</>
                        : `It votes only on ${decisionRules(config)[0].covers}; no vote moves funds.`}
                </p>
                <dl className="os-kv">
                    <div className="os-kv-row"><dt>The DAO's own address</dt><dd className="os-mono os-break">{dao}</dd></div>
                    <div className="os-kv-row"><dt>Held there</dt><dd><Held balance={own} /></dd></div>
                </dl>
                {own.data !== undefined && own.data > 0n && <p className="os-note os-warn">Coins at the DAO's own address cannot be withdrawn: the contract has no way to send them.</p>}
            </div>
            {config.schema === WEIGHTED_APPLICATIONS_SCHEMA && <Fees realmPath={realmPath} name={name} data={data} config={config} session={session} />}
        </div>
    )
}

function Fees({ realmPath, name, data, config, session }: { realmPath: string; name: string; data: WeightedSnapshot; config: WeightedV12Config; session: OsSession }) {
    const fees = useFeeDestinations(realmPath, config)
    if (!fees.data) return fees.isError ? <ErrorState message="The applications' treasuries could not be read." onRetry={() => void fees.refetch()} /> : <Loading label="Reading the applications' treasuries…" />
    const wallets = [...new Set(fees.data.flatMap((d) => [d.current, d.policyTreasury]).filter((a): a is string => !!a))]
    return (
        <section>
            <h3 className="os-h">Where fees go</h3>
            {fees.isError && <ErrorState message="The applications' treasuries could not be read again. This is the previous read." onRetry={() => void fees.refetch()} />}
            <ul className="os-list">{fees.data.map((d) => {
                const named = <span className="os-mono">{shortAddr(d.policyTreasury)}</span>
                return (
                    <li key={d.key} className="os-it os-top">
                        <span className="os-grow">
                            <b>{d.fees}</b>
                            <span className="os-sub os-block os-mono">{reveal(d.target)}</span>
                            {d.current === d.policyTreasury
                                ? <span className="os-block">Paid today to <span className="os-mono">{shortAddr(d.current)}</span>, the address the DAO's policy names.</span>
                                : <>
                                    <span className="os-block">{d.current === null ? "Its treasury could not be read." : d.current === "" ? "It has no treasury set." : <>Paid today to <span className="os-mono">{shortAddr(d.current)}</span>.</>}</span>
                                    <span className="os-sub os-block">
                                        {d.current === ""
                                            ? <>The DAO's policy names {named}. A financial vote can move the fees there only once {POLICY_LABELS[d.key]} has a treasury set and the DAO controls it.</>
                                            : d.current === null ? <>The DAO's policy names {named}.</>
                                                : <>The DAO's policy names {named} instead. While the DAO controls {POLICY_LABELS[d.key]} with no handover pending, a financial vote can move the fees there, and to no other address.</>}
                                    </span>
                                </>}
                            {/* Rendered for every row: once the fees have moved, it clears this member's lock. */}
                            <ProposeTreasury fees={d} realmPath={realmPath} name={name} data={data} config={config} session={session} />
                        </span>
                    </li>
                )
            })}</ul>
            <p className="os-sub">
                Escrow pays its service fee to the Market treasury. Only while that treasury is unset does it pay its own fallback recipient; while the DAO controls Escrow, a financial vote can propose another one, who must accept, and never the DAO itself.
            </p>
            <h3 className="os-h">The wallets</h3>
            <ul className="os-list">{wallets.map((address) => <Wallet key={address} realmPath={realmPath} address={address} />)}</ul>
            <p className="os-sub">Spending from a wallet takes its own signers, not a DAO vote.</p>
        </section>
    )
}
