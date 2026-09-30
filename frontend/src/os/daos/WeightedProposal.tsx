/**
 * One proposal of a weighted DAO in its own window: what it does, where its
 * vote stands, when it can execute, and the state its target was frozen at.
 *
 * @module os/daos/WeightedProposal
 */
import type { ReactNode } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { isUnreadableProposal, WEIGHTED_APPLICATIONS_SCHEMA, weightedProposalTitle, weightedWritesHeld, type WeightedMember, type WeightedProposal, type WeightedSnapshot } from "../../lib/dao/weighted"
import { applicationDetails, flattenBefore } from "../../lib/dao/weightedApplications"
import { revealInvisibleFormatting as reveal } from "../../lib/dao/v2Text"
import { CATEGORY_TEXT, EXECUTION_INVALIDATES, STATUS_TEXT, UNREADABLE_PROPOSAL, ballotText, chainTimeText, isOpenProposal, isVoteOpen, proposalTimes, statusNote, tallyText, weightedReadError, type BallotView } from "../../lib/dao/weightedView"
import { ErrorState, Loading, Pill, type PillTone } from "../kit"
import { shortAddr } from "../shell/format"
import type { OsSession } from "../shell/useOsSession"
import { useWeightedBallot, useWeightedProposalEntry } from "./useWeightedDao"

const STATUS_TONE: Partial<Record<WeightedProposal["status"], PillTone>> = { READY: "ok", TIMELOCKED: "warn", EXPIRED: "neutral", INVALIDATED: "neutral", EXECUTED: "neutral" }

export function StatusPill({ status }: { status: WeightedProposal["status"] }) {
    return <Pill tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Pill>
}

/** The governance write hold: no call is built for a weighted DAO that is not released on this network. */
export function WeightedHold() {
    return <p className="os-note">This DAO is read-only in Memba on {GNO_CHAIN_ID}: Memba builds no governance transaction for it here.</p>
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

export function WeightedProposalWindow({ realmPath, id, session }: { realmPath: string; id: string; session: OsSession }) {
    const q = useWeightedProposalEntry(realmPath, id)
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
            <Detail p={q.data.entry} snapshot={q.data.snapshot} realmPath={realmPath} ballot={readsBallot ? (ballot.isError ? "error" : ballot.data) : undefined} session={session} />
        </div>
    )
}

/**
 * What is left to do on an open proposal: a vote while voting is open (not
 * for an address the proposal's frozen electorate excludes), an execution
 * once it can execute.
 */
function leftToDo(p: WeightedProposal, ballot: BallotView = undefined): string {
    const votes = isVoteOpen(p) && !(ballot && ballot !== "error" && !ballot.eligible)
    if (votes) return p.ready ? "vote on it or execute it" : "vote on it, and execute it once it can"
    return p.ready ? "execute it" : "execute it once it can"
}

/** What the viewer can do about an open proposal, and why not when they cannot. A proposal that is over offers nothing. */
function Acting({ p, held, seat, ballot, session }: { p: WeightedProposal; held: boolean; seat: boolean; ballot: BallotView; session: OsSession }) {
    if (!isOpenProposal(p)) return null
    if (held) return <WeightedHold />
    // A session still resuming is neither a guest nor a member yet: it is asked nothing.
    if (session.status === "resuming") return null
    if (session.status === "guest") {
        return <><span className="os-sub">Seat holders {leftToDo(p)}. Connect a wallet to act.</span><button type="button" className="os-btn" onClick={session.openConnect}>Connect</button></>
    }
    if (!seat) return <p className="os-sub">Your address holds none of this DAO's seats, so you can read this proposal but not act on it.</p>
    return <p className="os-sub">From the workspace in this DAO's Proposals section, you can {leftToDo(p, ballot)}.</p>
}

function Detail({ p, snapshot, realmPath, ballot, session }: { p: WeightedProposal; snapshot: WeightedSnapshot; realmPath: string; ballot: BallotView; session: OsSession }) {
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
                <Acting p={p} held={weightedWritesHeld(GNO_CHAIN_ID, config.schema, realmPath)} seat={members.some((m) => m.address === session.address)} ballot={ballot} session={session} />
            </div>
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
