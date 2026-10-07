/**
 * One memba_gov proposal in its own window: what executes, the state it was
 * voted on, where the vote stands and when it can execute. An action Memba
 * cannot decode is shown raw, exactly as it will execute, with a warning.
 *
 * @module os/daos/GovProposal
 */
import type { ReactNode } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { BRIDGE_PATH, CLASS_NAMES, GOV_PATH, decodeGovAction, govNeverRuns } from "../../lib/dao/govActions"
import { govProposalTitle, govReadError, valueText } from "../../lib/dao/govView"
import type { GovProposal, GovRoster } from "../../lib/dao/membaGov"
import { formatChainTime } from "../../lib/dao/v2Lifecycle"
import { ErrorState, Loading } from "../kit"
import type { OsSession } from "../shell/useOsSession"
import { ProposalActions } from "./GovActions"
import { GovStatusPill } from "./GovFolder"
import { useGovProposal, useGovRoster, useTargetManifest } from "./useGovDao"

function Facts({ rows }: { rows: [string, ReactNode][] }) {
    return <dl className="os-kv">{rows.map(([label, value]) => <div key={label} className="os-kv-row"><dt>{label}</dt><dd className="os-break">{value}</dd></div>)}</dl>
}

const mono = (text: string) => <span className="os-mono">{text}</span>

export function GovProposalWindow({ id, session }: { id: string; session: OsSession }) {
    const proposal = useGovProposal(id)
    const rosterRead = useGovRoster()
    const p = proposal.data, roster = rosterRead.data
    if (!p || !roster) {
        const failed = proposal.isError ? proposal : rosterRead.isError ? rosterRead : null
        return failed ? <ErrorState message={govReadError(failed.error)} onRetry={() => void failed.refetch()} /> : <Loading label={`Reading proposal #${id}…`} />
    }
    return (
        <div className="os-stack">
            {proposal.isError && <ErrorState message={`${govReadError(proposal.error)} This is the previous read.`} onRetry={() => void proposal.refetch()} />}
            <div>
                <div className="os-holding-title">#{p.id} {govProposalTitle(p)}</div>
                <div className="os-row"><GovStatusPill status={p.status} /><span className="os-sub">{CLASS_NAMES[p.class]} · proposed by {p.proposer}</span></div>
            </div>
            <Action p={p} />
            <ProposalActions p={p} roster={roster} session={session} raw={decodeGovAction(p.target, p.action, p.args) === null} />
            {p.note && (
                <section>
                    <h3 className="os-h">Proposer's note</h3>
                    <p className="os-sub os-pre os-break">{p.note}</p>
                    <p className="os-sub">The proposer's own words: nothing checks them against the action above.</p>
                </section>
            )}
            <Facts rows={[
                ["Filed", formatChainTime(Number(p.created))],
                ["Voting closes", formatChainTime(Number(p.deadline))],
                ...(p.readyAt !== "0" ? [["Can execute from", formatChainTime(Number(p.readyAt))] as [string, ReactNode]] : []),
            ]} />
            <Ballots p={p} roster={roster} />
        </div>
    )
}

function Action({ p }: { p: GovProposal }) {
    const decoded = decodeGovAction(p.target, p.action, p.args)
    if (decoded) {
        const never = govNeverRuns(p, decoded)
        return (
            <section>
                <h3 className="os-h">What executes</h3>
                {never && <p className="os-note os-err" role="alert">This proposal can never execute. {never}</p>}
                <Facts rows={[
                    ["Through", mono(p.target === BRIDGE_PATH ? `${BRIDGE_PATH} (the bridge that governs the Memba apps)` : `${GOV_PATH} (the roster)`)],
                    ...decoded.rows.map((r) => [r.label, r.kind === "address" || r.kind === "hash" ? mono(r.value) : valueText(r.kind, r.value)] as [string, ReactNode]),
                    ...(p.target === BRIDGE_PATH ? [["Scope (what one execution invalidates)", mono(p.scope)] as [string, ReactNode]] : []),
                ]} />
                <p className="os-sub">The values marked "now" or "when voted" are the app's state this approval is bound to: if it changes before execution, the approval no longer matches and cannot run.</p>
            </section>
        )
    }
    return <RawAction p={p} />
}

function RawAction({ p }: { p: GovProposal }) {
    const manifest = useTargetManifest(p.target, true)
    return (
        <section>
            <h3 className="os-h">What executes (not decoded)</h3>
            <p className="os-note os-warn" role="alert">
                Memba cannot read this action. If it passes, the realm below may run exactly this action with these arguments, once.
                Read that realm's code before voting yes.
            </p>
            {manifest.data === "absent" && <p className="os-note os-err">No realm is published at this address on {GNO_CHAIN_ID} now. One could be published there later and run it.</p>}
            {manifest.data === "private" && <p className="os-note os-err">This realm is private: its creator can replace its code after the vote.</p>}
            <Facts rows={[["Target realm", mono(p.target)], ["Action", mono(p.action)], ["Arguments", mono(p.args || "(none)")], ["Scope", mono(p.scope || "(none)")]]} />
        </section>
    )
}

function Ballots({ p, roster }: { p: GovProposal; roster: GovRoster }) {
    const weightOf = (person: string) => roster.members.find((m) => m.id === person)?.weight ?? 0
    const yes = p.ballots.filter((b) => b.vote === "yes")
    const yesWeight = yes.reduce((w, b) => w + weightOf(b.person), 0)
    return (
        <section>
            <h3 className="os-h">Votes</h3>
            <p className="os-sub">YES: {yes.length} of {roster.persons} people, weight {yesWeight} of {roster.weight}.</p>
            {p.ballots.length === 0 ? <p className="os-sub">No votes yet.</p> : <ul className="os-list">{p.ballots.map((b) => (
                <li key={b.person} className="os-it">
                    <span className="os-grow"><b>{b.person}</b></span>
                    <span className="os-sub">{b.vote.toUpperCase()}{b.vote === "yes" ? ` since ${formatChainTime(Number(b.since))}` : ""}</span>
                </li>
            ))}</ul>}
        </section>
    )
}
