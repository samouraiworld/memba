/**
 * A weighted DAO (the governing Memba DAO) in its DAO folder window: how it
 * decides, its seats, its proposals, the applications it governs and where
 * their fees go. It reads the DAO through its own versioned contract
 * (lib/dao/weighted), never through the equal-headcount loaders the other DAO
 * kinds use.
 *
 * A seat holder votes and executes in each proposal's window. Proposing (and
 * acting on older contract versions) still runs in the weighted workspace,
 * shown inside the Proposals section on request.
 *
 * @module os/daos/WeightedDaoFolder
 */
import { lazy, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { revealInvisibleFormatting as reveal } from "../../lib/dao/v2Text"
import { isUnreadableProposal, WEIGHTED_APPLICATIONS_SCHEMA, weightedProposalTitle, weightedWritesHeld, type WeightedProposal, type WeightedSnapshot, type WeightedV12Config } from "../../lib/dao/weighted"
import { ACCEPTANCE_CONSEQUENCES, ACCEPTANCE_LABELS, ACCEPTANCE_ORDER, AUTHORITY_GETTERS, nextRecommendedAcceptance, weightedDaoAddress, type AcceptanceState } from "../../lib/dao/weightedAcceptance"
import { teamWallet } from "../../lib/dao/weightedTreasury"
import { CATEGORY_TEXT, POLICY_LABELS, UNREADABLE_PROPOSAL, applicationRules, decisionRules, invalidationRule, isOpenProposal, roleText, seatText, seatsRule, tallyText, votingRule, weightedDaoTitle, weightedReadError } from "../../lib/dao/weightedView"
import { isWalletRequestPending, subscribeWalletActivity } from "../../lib/walletActivity"
import { ErrorState, Loading, Pill, type PillTone } from "../kit"
import { shortAddr } from "../shell/format"
import { ThingTile } from "../shell/icons"
import type { DaoSection } from "../shell/osPath"
import type { OsSession } from "../shell/useOsSession"
import { daoSpec, specForTarget, type WindowSpec } from "../shell/windows"
import { formatUgnot } from "../wallet/send"
import { StatusPill, WeightedHold } from "./WeightedProposal"
import { useAcceptanceStates, useFeeDestinations, useRefreshWeightedDao, useWeightedBalance, useWeightedSnapshot } from "./useWeightedDao"

const ClassicPage = lazy(() => import("../page/ClassicPage").then((m) => ({ default: m.ClassicPage })))

interface FolderProps { name: string; realmPath: string; section: DaoSection; open: (spec: WindowSpec) => void; session: OsSession; active?: boolean }

export function WeightedDaoFolder(props: FolderProps) {
    const { realmPath, section, session, active } = props
    const snapshot = useWeightedSnapshot(realmPath)
    const [workspace, setWorkspace] = useState(false)
    // Closing the workspace unmounts nothing the focus could stay on: it goes back to the button that opened it.
    const returnFocusRef = useRef(false)
    const data = snapshot.data
    if (!data) return snapshot.isError ? <ErrorState message={weightedReadError(snapshot.error)} onRetry={() => void snapshot.refetch()} /> : <Loading label="Reading governance state…" />
    const inWorkspace = workspace && section === "proposals"
    return (
        <>
            {/* A later read that fails leaves the previous one on screen, and says so. */}
            {snapshot.isError && <ErrorState message={`${weightedReadError(snapshot.error)} This is the previous read.`} onRetry={() => void snapshot.refetch()} />}
            {/* Once open, the workspace stays mounted behind the other sections: a signature it is waiting for is not lost to a tab. */}
            {workspace && <div hidden={!inWorkspace}><Workspace realmPath={realmPath} session={session} active={active && inWorkspace} close={() => { returnFocusRef.current = true; setWorkspace(false) }} /></div>}
            {inWorkspace ? null
                : section === "proposals" ? <Proposals {...props} newest={data} openWorkspace={() => setWorkspace(true)} returnFocusRef={returnFocusRef} />
                    : section === "members" ? <Members data={data} session={session} />
                        : section === "treasury" ? <Treasury realmPath={realmPath} data={data} />
                            : <Overview {...props} data={data} />}
        </>
    )
}

/** The weighted workspace inside the window. What is done in it changes what the native sections show, so they are read again when its wallet request ends and when it closes. */
function Workspace({ realmPath, session, active, close }: { realmPath: string; session: OsSession; active?: boolean; close: () => void }) {
    const refresh = useRefreshWeightedDao(realmPath)
    const signing = useSyncExternalStore(subscribeWalletActivity, isWalletRequestPending)
    const wasSigning = useRef(false)
    const heading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        if (wasSigning.current && !signing) void refresh()
        wasSigning.current = signing
    }, [signing, refresh])
    // The button that opened it is gone: focus moves to what replaced it.
    useEffect(() => { heading.current?.focus() }, [])
    return (
        <div className="os-stack os-tight">
            <h3 ref={heading} tabIndex={-1} className="os-h">Propose, vote or execute</h3>
            <div className="os-row">
                {/* Closing the workspace while the wallet is open would drop its result. */}
                <button type="button" className="os-btn os-quiet" disabled={signing} onClick={() => { void refresh(); close() }}>Back to the proposal list</button>
                {signing && <span className="os-sub" role="status">A wallet request is open. The workspace stays open until it ends.</span>}
            </div>
            <ClassicPage network={session.network.key} page={`weighted-dao/${realmPath}`} layout={session.layout} active={active} />
        </div>
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
                <p className="os-sub os-flush">{config.rosterSize} seats · {config.totalPoints} voting points · {GNO_CHAIN_ID}</p>
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
            {config.schema === WEIGHTED_APPLICATIONS_SCHEMA && <Applications realmPath={realmPath} config={config} />}
        </div>
    )
}

const STATE_TONE: Record<AcceptanceState["kind"], PillTone | undefined> = { dao: "ok", ready: undefined, blocked: "err", awaiting: "neutral" }

function Applications({ realmPath, config }: { realmPath: string; config: WeightedV12Config }) {
    const acceptance = useAcceptanceStates(realmPath, config)
    const states = acceptance.data ?? {}
    const read = ACCEPTANCE_ORDER.map((key) => states[key]).filter((s): s is AcceptanceState => s !== undefined && s !== "error")
    const total = ACCEPTANCE_ORDER.length
    return (
        <section>
            <h3 className="os-h">Applications the DAO governs</h3>
            <p className="os-sub">
                Each application is handed over in two steps: its publisher nominates the DAO, then the DAO accepts by a critical vote, one application at a time.
                {/* A count is a claim about all of them: none is made from a partial read. */}
                {acceptance.data && (read.length === total ? ` The DAO controls ${read.filter((s) => s.kind === "dao").length} of ${total} today.` : ` ${total - read.length} of ${total} could not be read.`)}
            </p>
            {/* A later read that fails leaves the previous one on screen, and says so. */}
            {acceptance.isError && <ErrorState message={acceptance.data ? "The applications' current owners could not be read again. This is the previous read." : "The applications' current owners could not be read."} onRetry={() => void acceptance.refetch()} />}
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

function Proposals({ name, realmPath, open, session, newest, openWorkspace, returnFocusRef }: FolderProps & { newest: WeightedSnapshot; openWorkspace: () => void; returnFocusRef: RefObject<boolean> }) {
    const [before, setBefore] = useState("0")
    const older = useWeightedSnapshot(realmPath, before, before !== "0")
    const page = before === "0" ? newest : older.data
    const held = weightedWritesHeld(GNO_CHAIN_ID, newest.config.schema, realmPath)
    const seat = newest.members.some((m) => m.address === session.address)
    // Consumed by the button's ref when it mounts; a close that mounts no button (the seat went away) must not steal focus later.
    useEffect(() => { returnFocusRef.current = false }, [returnFocusRef])
    return (
        <div className="os-stack os-tight">
            <div className="os-row os-between">
                <span className="os-sub">{newest.page.total} {newest.page.total === "1" ? "proposal" : "proposals"} recorded</span>
                {/* Acting needs a seat: a guest is asked to connect here, and only here. A session still resuming is asked nothing. */}
                {held ? null
                    : session.status === "guest" ? <button type="button" className="os-btn" onClick={session.openConnect}>Connect to propose, vote or execute</button>
                        : seat && (
                            <button type="button" className="os-btn" onClick={openWorkspace}
                                ref={(node) => { if (node && returnFocusRef.current) { returnFocusRef.current = false; node.focus() } }}>Propose, vote or execute</button>
                        )}
            </div>
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
                Admin and finance roles add no voting power and no exclusive right to execute.
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

function Treasury({ realmPath, data }: { realmPath: string; data: WeightedSnapshot }) {
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
            {config.schema === WEIGHTED_APPLICATIONS_SCHEMA && <Fees realmPath={realmPath} config={config} />}
        </div>
    )
}

function Fees({ realmPath, config }: { realmPath: string; config: WeightedV12Config }) {
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
                                        The DAO's policy names {named}{d.current ? " instead" : ""}. While the DAO controls {POLICY_LABELS[d.key]}, a financial vote can move the fees there, and to no other address.
                                    </span>
                                </>}
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
