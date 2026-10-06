/**
 * One proposal of a weighted DAO in its own window: what it does, where its
 * vote stands, when it can execute, and the state its target was frozen at.
 * Nothing is signed here: Memba OS builds no weighted DAO call.
 *
 * @module os/daos/WeightedProposal
 */
import type { ReactNode } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { isUnreadableProposal, WEIGHTED_APPLICATIONS_SCHEMA, weightedProposalTitle, weightedWritesHeld, type WeightedMember, type WeightedProposal, type WeightedSnapshot } from "../../lib/dao/weighted"
import { applicationDetails, flattenBefore } from "../../lib/dao/weightedApplications"
import { revealInvisibleFormatting as reveal } from "../../lib/dao/v2Text"
import { CATEGORY_TEXT, EXECUTION_INVALIDATES, STATUS_TEXT, UNREADABLE_PROPOSAL, ballotText, chainTimeText, isOpenProposal, isVoteOpen, proposalTimes, statusNote, tallyText, weightedReadError, type BallotView, writesHeldText, OS_READS_ONLY, v12ReadOnlyText } from "../../lib/dao/weightedView"
import { ErrorState, Loading, Pill, type PillTone } from "../kit"
import { shortAddr } from "../shell/format"
import type { OsSession } from "../shell/useOsSession"
import { useWeightedBallot, useWeightedBallots, useWeightedProposalEntry } from "./useWeightedDao"
import { Voters } from "./Voters"

const STATUS_TONE: Partial<Record<WeightedProposal["status"], PillTone>> = { READY: "ok", TIMELOCKED: "warn", EXPIRED: "neutral", INVALIDATED: "neutral", EXECUTED: "neutral" }

export function StatusPill({ status }: { status: WeightedProposal["status"] }) {
    return <Pill tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Pill>
}

/** Why nothing can be done on a weighted DAO here: v12 (Memba DAO) is read-only in Memba, and Memba OS builds no weighted DAO call. */
export function WeightedReadOnly({ schema, realmPath }: { schema: string; realmPath: string }) {
    const text = schema === WEIGHTED_APPLICATIONS_SCHEMA ? v12ReadOnlyText(realmPath) : weightedWritesHeld(GNO_CHAIN_ID) ? writesHeldText(GNO_CHAIN_ID) : OS_READS_ONLY
    return <p className="os-note">{text}</p>
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
            <Detail p={q.data.entry} snapshot={q.data.snapshot} realmPath={realmPath} ballot={readsBallot ? (ballot.isError ? "error" : ballot.data) : undefined} />
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

interface DetailProps { p: WeightedProposal; snapshot: WeightedSnapshot; realmPath: string; ballot: BallotView }

function Detail({ p, snapshot, realmPath, ballot }: DetailProps) {
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
                {isOpenProposal(p) && <WeightedReadOnly schema={config.schema} realmPath={realmPath} />}
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
