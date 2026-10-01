/**
 * One proposal of a weighted DAO in its own window: what it does, where its
 * vote stands, when it can execute, and the state its target was frozen at.
 * A seat holder votes and executes here, through the Memba OS signing sheet.
 *
 * @module os/daos/WeightedProposal
 */
import { useEffect, useState, type ReactNode } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { clearGovernanceReceipt, governanceRequestActive, type GovernanceScope } from "../../lib/dao/governanceRecovery"
import { weightedLocks, weightedLockSettled } from "../../lib/dao/weightedActions"
import { isUnreadableProposal, WEIGHTED_APPLICATIONS_SCHEMA, weightedProposalTitle, weightedWriteKinds, weightedWritesHeld, type WeightedMember, type WeightedProposal, type WeightedSnapshot } from "../../lib/dao/weighted"
import { applicationDetails, flattenBefore } from "../../lib/dao/weightedApplications"
import { revealInvisibleFormatting as reveal } from "../../lib/dao/v2Text"
import { CATEGORY_TEXT, EXECUTION_INVALIDATES, STATUS_TEXT, UNREADABLE_PROPOSAL, ballotText, chainTimeText, isOpenProposal, isVoteOpen, openProposalsOf, proposalTimes, statusNote, tallyText, weightedDaoTitle, weightedReadError, type BallotView, writesHeldText, CURRENT_VERSION_ONLY } from "../../lib/dao/weightedView"
import { ErrorState, Loading, Pill, type PillTone } from "../kit"
import { shortAddr } from "../shell/format"
import type { OsSession } from "../shell/useOsSession"
import { useSigner } from "../sign/signerContext"
import { UnknownOutcome } from "./UnknownOutcome"
import { useRefreshWeightedDao, useWeightedBallot, useWeightedBallots, useWeightedProposalEntry, useWeightedSnapshot } from "./useWeightedDao"
import { Voters } from "./Voters"
import type { SignRequest } from "../sign/signer"
import { quoteWeightedGasPrice, weightedExecuteRequest, weightedVoteOptions, weightedVoteRequest, type WeightedRequestContext } from "./weightedRequest"

const STATUS_TONE: Partial<Record<WeightedProposal["status"], PillTone>> = { READY: "ok", TIMELOCKED: "warn", EXPIRED: "neutral", INVALIDATED: "neutral", EXECUTED: "neutral" }

export function StatusPill({ status }: { status: WeightedProposal["status"] }) {
    return <Pill tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Pill>
}

/** The governance write hold: no call is built for a weighted DAO that is not released on this network. */
export function WeightedHold() {
    return <p className="os-note">{writesHeldText(GNO_CHAIN_ID)}</p>
}

/** A seat holder by name, anyone else by short address. */
function seatName(members: readonly WeightedMember[], address: string): string {
    const seat = members.find((m) => m.address === address)
    return seat ? reveal(seat.personId) : shortAddr(address)
}

function Measure({ label, value, whole }: { label: string; value: number; whole: number }) {
    return (
        <div className="os-tally">
            <div className="os-row os-between"><span>{label}</span><span className="os-sub">{value} of {whole}</span></div>
            <div className="os-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round((value / whole) * 100))}%` }} /></div>
        </div>
    )
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
    return <dl className="os-kv">{rows.map(([label, value]) => <div key={label} className="os-kv-row"><dt>{label}</dt><dd className="os-break">{value}</dd></div>)}</dl>
}

function actionFacts(p: WeightedProposal, members: readonly WeightedMember[]): [string, ReactNode][] {
    const a = p.action
    if (a.type === "set-role") return [["Member", seatName(members, a.target)], ["Address", <span className="os-mono">{a.target}</span>], ["Change", `${a.grant ? "Grant" : "Remove"} the ${a.role} role`]]
    if (a.type === "recover-member") return [["Person", reveal(a.personId)], ["Old address", <span className="os-mono">{a.oldAddress}</span>], ["Replacement address", <span className="os-mono">{a.newAddress}</span>]]
    return [["Target realm", <span className="os-mono">{reveal(a.target)}</span>], ...applicationDetails(a)]
}

export function WeightedProposalWindow({ realmPath, dao, id, session }: { realmPath: string; dao: string; id: string; session: OsSession }) {
    const q = useWeightedProposalEntry(realmPath, id)
    const signer = useSigner()
    const refresh = useRefreshWeightedDao(realmPath)
    // After a signature settles, read the DAO again: the status, the tally and the ballot may have changed.
    useEffect(() => { if (signer.version) void refresh() }, [signer.version, refresh])
    const entry = q.data?.entry
    // A seat's ballot exists only on the application version, and only for a proposal Memba could read.
    const readsBallot = session.status === "member" && q.data?.snapshot.config.schema === WEIGHTED_APPLICATIONS_SCHEMA && !!entry && !isUnreadableProposal(entry)
    const ballot = useWeightedBallot(realmPath, id, session.address, readsBallot)
    if (q.data === undefined) return q.error ? <ErrorState message={weightedReadError(q.error)} onRetry={q.refetch} /> : <Loading label={`Loading proposal #${id}…`} />
    if (!q.data) return <p className="os-note os-warn">This DAO has no proposal #{id}.</p>
    // A later read that fails leaves the previous one on screen, and says so.
    const stale = q.error && <ErrorState message={`${weightedReadError(q.error)} This is the previous read.`} onRetry={q.refetch} />
    if (isUnreadableProposal(q.data.entry)) {
        return (
            <div className="os-stack os-tight">
                {stale}
                <h3 className="os-holding-title">Unreadable proposal #{id}</h3>
                <p className="os-note os-warn">{UNREADABLE_PROPOSAL}</p>
            </div>
        )
    }
    return (
        <div className="os-stack">
            {stale}
            <Detail p={q.data.entry} snapshot={q.data.snapshot} realmPath={realmPath} dao={dao} ballot={readsBallot ? (ballot.isError ? "error" : ballot.data) : undefined} session={session} />
        </div>
    )
}

/**
 * Every seat's ballot on this proposal (the application version publishes
 * ballots). The electorate is frozen when a proposal opens: a seat whose key
 * changed since votes on it with its earlier address, which this list does not
 * read, so it claims nothing for that seat.
 */
function SeatBallots({ realmPath, p, members }: { realmPath: string; p: WeightedProposal; members: readonly WeightedMember[] }) {
    const ballots = useWeightedBallots(realmPath, p.id, members.map((m) => m.address), true)
    const open = isVoteOpen(p)
    return (
        <Voters error={ballots.isError} rows={ballots.data?.map((b) => {
            const seat = members.find((m) => m.address === b.voter)!
            return {
                address: b.voter,
                name: reveal(seat.personId),
                choice: !b.eligible ? "Key changed" : b.choice ? b.choice[0].toUpperCase() + b.choice.slice(1) : open ? "Not voted" : "Did not vote",
                weight: seat.weight === 1 ? "1 point" : `${seat.weight} points`,
            }
        })}>
            {ballots.data?.some((b) => !b.eligible) && <p className="os-sub">A seat whose key changed after this proposal opened votes on it with its earlier address, which this list does not read.</p>}
        </Voters>
    )
}

/** What seat holders can still do on an open proposal: vote while voting is open, execute once it can. */
function leftToDo(p: WeightedProposal): string {
    if (isVoteOpen(p)) return p.ready ? "vote on it or execute it" : "vote on it, and execute it once it can"
    return p.ready ? "execute it" : "execute it once it can"
}

interface ActingProps { p: WeightedProposal; snapshot: WeightedSnapshot; realmPath: string; dao: string; ballot: BallotView; session: OsSession }

/** What the viewer can do about an open proposal, and why not when they cannot. A proposal that is over offers nothing. */
function Acting(props: ActingProps) {
    const { p, snapshot, realmPath, session } = props
    if (!isOpenProposal(p)) return null
    if (weightedWritesHeld(GNO_CHAIN_ID, snapshot.config.schema, realmPath)) return <WeightedHold />
    if (snapshot.config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) return <p className="os-sub">{CURRENT_VERSION_ONLY}</p>
    // A session still resuming is neither a guest nor a member yet: it is asked nothing.
    if (session.status === "resuming") return null
    if (session.status === "guest") {
        return <><span className="os-sub">Seat holders {leftToDo(p)}. Connect a wallet to act.</span><button type="button" className="os-btn" onClick={session.openConnect}>Connect</button></>
    }
    if (!snapshot.members.some((m) => m.address === session.address)) return <p className="os-sub">Your address holds none of this DAO's seats, so you can read this proposal but not act on it.</p>
    return <SeatActions {...props} />
}

/**
 * A seat holder's vote and execution, each through the Memba OS signing sheet.
 * While an earlier vote or execution on this proposal has an unknown outcome,
 * neither is offered until the member says they checked it.
 */
function SeatActions({ p, snapshot, realmPath, dao, ballot, session }: ActingProps) {
    const signer = useSigner()
    const newest = useWeightedSnapshot(realmPath)
    const [, rerender] = useState(0)
    const [failed, setFailed] = useState<string | null>(null)
    const caller = session.address
    // Receipts live in browser storage: another tab's lock shows here as soon as it is written.
    useEffect(() => {
        const reread = () => rerender((x) => x + 1)
        window.addEventListener("storage", reread)
        return () => window.removeEventListener("storage", reread)
    }, [])
    const locks = weightedLocks(GNO_CHAIN_ID, realmPath, caller, p.id)
    // A lock the chain has since made moot is cleared, and shown until the clear succeeds (it cannot while its request is in
    // flight). The receipt is in the key, so the clear is tried again once the signer has saved its own. Within this tab, the
    // window re-renders when a signature settles; other tabs' receipts arrive through the storage event above.
    const mootKey = JSON.stringify(locks.filter((l) => weightedLockSettled(l, p, ballot)).map(({ scope, receipt }) => ({ scope, receipt })))
    useEffect(() => {
        let cleared = false
        for (const { scope } of JSON.parse(mootKey) as { scope: GovernanceScope }[]) {
            try { clearGovernanceReceipt(scope); cleared = true } catch { /* its request is still in flight: the signer settles it */ }
        }
        // The receipts live in browser storage, outside React: read them again once cleared.
        if (cleared) queueMicrotask(() => rerender((x) => x + 1))
    }, [mootKey])
    const [lock] = locks
    // This tab's own request, still waiting for the wallet, is not an unknown outcome yet.
    if (lock && governanceRequestActive(lock.scope)) return <p className="os-sub" role="status">Waiting for the wallet…</p>
    if (lock) {
        return <UnknownOutcome key={JSON.stringify(lock.scope)} scope={lock.scope} receipt={lock.receipt!} attempt={lock.operation === "vote" ? "vote" : "execution"}
            again="voting or executing again" onCleared={() => rerender((x) => x + 1)} />
    }
    const { schema } = snapshot.config
    const kinds = weightedWriteKinds(schema, GNO_CHAIN_ID, realmPath)
    const votes = kinds.has("vote") ? weightedVoteOptions(p, schema, ballot) : []
    const executes = kinds.has("execute") && p.ready
    // What executing it would invalidate, as far as the newest proposals were read.
    const others = newest.data ? openProposalsOf(newest.data.page) : { open: [], complete: false }
    const otherOpen = others.open.filter((o) => o.id !== p.id).map((o) => o.id)
    // The fee is quoted when the member asks to act, and shown exactly in the review.
    // A request refused as it is built (a lock another tab wrote since this render) is said here; the re-render shows that lock.
    const review = async (request: (ctx: WeightedRequestContext) => SignRequest<string>) => {
        setFailed(null)
        try { signer.sign(request({ realmPath, daoName: weightedDaoTitle(realmPath, dao), snapshot, proposal: p, caller, gasPrice: await quoteWeightedGasPrice() })) }
        catch (err) { setFailed(err instanceof Error ? err.message : String(err)) }
    }
    if (votes?.length === 0 && !executes) {
        return isVoteOpen(p) ? null : <p className="os-sub">Voting is over. Any seat holder can execute it from the earliest time above.</p>
    }
    return (
        <div className="os-row">
            {votes === null ? <span className="os-sub" role="status">Reading your ballot…</span>
                : votes.length > 0 && <button type="button" className="os-btn" onClick={() => void review((ctx) => weightedVoteRequest(ctx, votes) as SignRequest<string>)}>Vote…</button>}
            {executes && <button type="button" className="os-btn" onClick={() => void review((ctx) => weightedExecuteRequest(ctx, otherOpen, others.complete))}>Execute…</button>}
            {failed && <p className="os-note os-warn" role="alert">{failed}</p>}
        </div>
    )
}

function Detail({ p, snapshot, realmPath, dao, ballot, session }: ActingProps) {
    const { config, members } = snapshot
    const mine = ballotText(ballot, isVoteOpen(p))
    const note = statusNote(p)
    return (
        <>
            <div>
                <div className="os-row os-tight-row"><StatusPill status={p.status} /><span className="os-sub">{CATEGORY_TEXT[p.category]} decision</span></div>
                <h3 className="os-holding-title">#{p.id} {weightedProposalTitle(p)}</h3>
                <div className="os-sub">Proposed by {seatName(members, p.proposer)} on {chainTimeText(p.createdAt)}</div>
            </div>
            <Facts rows={actionFacts(p, members)} />
            {p.action.type === "recover-member" && <p className="os-sub os-flush">The person keeps their identity, voting weight and roles; only the address changes.</p>}
            {p.talliesAvailable ? (
                <div className="os-stack os-tight">
                    {/* The read contract refuses a proposal that reports tallies without all three counts. */}
                    <Measure label="Points voting yes" value={p.weightYes!} whole={config.totalPoints} />
                    <Measure label="People voting yes" value={p.peopleYes!} whole={config.rosterSize} />
                    <Measure label="Developers voting yes" value={p.developersYes!} whole={members.filter((m) => !m.founder).length} />
                </div>
            ) : <p className="os-sub os-flush">{tallyText(p)}</p>}
            {note && <p className="os-note">{note}</p>}
            {isOpenProposal(p) && <p className="os-note os-warn">{EXECUTION_INVALIDATES}</p>}
            <Facts rows={proposalTimes(p).map((t): [string, ReactNode] => [t.label, <time dateTime={t.iso}>{t.text}</time>])} />
            <div className="os-vote">
                {mine && <p className="os-note">{mine}</p>}
                <Acting p={p} snapshot={snapshot} realmPath={realmPath} dao={dao} ballot={ballot} session={session} />
            </div>
            {config.schema === WEIGHTED_APPLICATIONS_SCHEMA && <SeatBallots realmPath={realmPath} p={p} members={members} />}
            {"before" in p.action && (
                <details className="os-card">
                    <summary>State frozen at proposal time</summary>
                    <p className="os-sub">Execution is refused if the target realm no longer matches this state.</p>
                    <Facts rows={flattenBefore(p.action.before)} />
                </details>
            )}
        </>
    )
}
