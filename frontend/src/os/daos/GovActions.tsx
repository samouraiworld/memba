/**
 * What a visitor can do on Memba DAO: vote and execute in a proposal's
 * window, join with an invited key, and pause an app in an emergency. A guest
 * is offered Connect at the signing step; a YES on an action Memba cannot
 * read needs the member's own acknowledgement, never one click.
 *
 * @module os/daos/GovActions
 */
import { useState } from "react"
import { BRIDGE_APPS, BRIDGE_PATH, GOV_PATH, bridgeCall, decodeGovAction, govNeverRuns } from "../../lib/dao/govActions"
import { bridgePublished, PAUSABLE_APPS, type GovProposal, type GovRoster } from "../../lib/dao/membaGov"
import { formatChainTime } from "../../lib/dao/v2Lifecycle"
import type { OsSession } from "../shell/useOsSession"
import { useNowSeconds } from "../shell/useNowSeconds"
import { govExecuteRequest, govJoinRequest, govPauseRequest, govScope, govVoteRequest } from "./govRequests"
import { useGovSign } from "./useGovSign"
import { useBridgePauses, useDisputeParties } from "./useGovDao"

const OPEN = new Set<GovProposal["status"]>(["voting", "timelocked", "ready"])

export function ProposalActions({ p, roster, session, raw }: { p: GovProposal; roster: GovRoster; session: OsSession; raw: boolean }) {
    const { quoting, start, lock, failed } = useGovSign(session)
    const [readCode, setReadCode] = useState(false)
    const now = useNowSeconds()
    const dispute = p.target === BRIDGE_PATH && p.action === "escrow_v4.ResolveDispute" ? decodeGovAction(p.target, p.action, p.args)?.rows[0].value ?? null : null
    const parties = useDisputeParties(session.status === "member" ? dispute : null)
    if (!OPEN.has(p.status)) return null
    if (session.status !== "member") return <button type="button" className="os-btn" onClick={session.openConnect}>Connect to vote</button>
    const me = roster.members.find((m) => m.address === session.address)
    if (!me) return <p className="os-sub">Only seated members vote. An invited key joins first, from the Members tab.</p>
    const voteLock = lock(govScope(session.address, `vote:${p.id}`), "vote")
    const execLock = lock(govScope(session.address, `execute:${p.id}`), "execution")
    const mine = p.ballots.find((b) => b.person === me.id)
    const closed = now >= Number(p.deadline)
    const vote = (v: "yes" | "no" | "abstain") => start((s) => govVoteRequest(s, p, v, raw))
    const decoded = decodeGovAction(p.target, p.action, p.args)
    // Memba offers Execute only for what can run: a roster action, or an app action the bridge would accept as voted.
    const executable = decoded !== null && govNeverRuns(p, decoded) === null && (p.target === GOV_PATH || (bridgePublished() && bridgeCall(p.action, p.args) !== null))
    return (
        <section className="os-stack os-tight">
            <h3 className="os-h">Your vote</h3>
            {failed}
            {parties.data && (parties.data.client === session.address || parties.data.freelancer === session.address) && (
                <p className="os-note os-warn" role="alert">
                    You are the {parties.data.client === session.address ? "client" : "freelancer"} of this contract. Members agreed that a party to a dispute
                    does not vote on it, and does not pause escrow while it is open.
                </p>
            )}
            {mine && <p className="os-note">You voted <b>{mine.vote.toUpperCase()}</b>{mine.vote === "yes" ? ` (since ${formatChainTime(Number(mine.since))})` : ""}.</p>}
            {voteLock || (closed
                // After the deadline a YES can still be withdrawn, to stop an approval before it runs.
                ? mine?.vote === "yes" && <button type="button" className="os-btn" disabled={quoting} onClick={() => start((s) => govVoteRequest(s, p, "no", raw, true))}>{quoting ? "Reading the fee…" : "Withdraw your YES…"}</button>
                : <>
                    {raw && (
                        <label className="os-row">
                            <input type="checkbox" checked={readCode} onChange={(e) => setReadCode(e.target.checked)} />
                            <span>I have read the code of {p.target}; Memba cannot read this action.</span>
                        </label>
                    )}
                    <div className="os-row">
                        {(["yes", "no", "abstain"] as const).map((v) => (
                            <button key={v} type="button" className="os-btn" disabled={quoting || mine?.vote === v || (v === "yes" && raw && !readCode)} onClick={() => vote(v)}>
                                {quoting ? "Reading the fee…" : `Vote ${v.toUpperCase()}…`}
                            </button>
                        ))}
                    </div>
                </>)}
            {p.status === "ready" && (execLock || (executable
                ? <button type="button" className="os-btn" disabled={quoting} onClick={() => start((s) => govExecuteRequest(s, p))}>{quoting ? "Reading the fee…" : "Execute…"}</button>
                : !decoded && <p className="os-sub">Ready: its target realm runs it when called, and checks this approval then.</p>))}
        </section>
    )
}

/** An invited key seats itself. */
export function JoinAction({ roster, session }: { roster: GovRoster; session: OsSession }) {
    const { quoting, start, lock, failed } = useGovSign(session)
    const invite = session.status === "member" ? roster.invitations.find((i) => i.address === session.address) : undefined
    if (!invite) return null
    return lock(govScope(session.address, "join"), "join") || (
        <>{failed}<button type="button" className="os-btn" disabled={quoting} onClick={() => start((s) => govJoinRequest(s, invite.id))}>
            {quoting ? "Reading the fee…" : `Join as ${invite.id}…`}
        </button></>
    )
}

/** The apps the bridge can pause: a seated member pauses one for 7 days; anyone ends a pause that is over. */
export function EmergencyPauses({ roster, session }: { roster: GovRoster; session: OsSession }) {
    const enabled = bridgePublished()
    const pauses = useBridgePauses(enabled)
    const { quoting, start, lock, failed } = useGovSign(session)
    const now = useNowSeconds()
    if (!enabled) return null
    const seated = session.status === "member" && roster.members.some((m) => m.address === session.address)
    return (
        <section>
            <h3 className="os-h">Emergency pause</h3>
            <p className="os-sub">A seated member can pause an app the DAO governs for 7 days without a vote, once every 30 days. A vote ends or extends it; anyone ends it once it is over.</p>
            {pauses.isError && <p className="os-note os-err">Couldn't read the pauses.</p>}
            {failed}
            <ul className="os-list">{PAUSABLE_APPS.map((app) => {
                const { until, governed } = pauses.data?.[app] ?? { until: 0, governed: false }
                const over = until > 0 && until <= now
                // No control until the pause is known, nor for an app the bridge does not govern.
                const control = session.status !== "member" || !pauses.data || !governed ? null
                    : lock(govScope(session.address, `${over ? "expire" : "pause"}:${app}`), "pause")
                    || (over ? <button type="button" className="os-btn os-quiet" disabled={quoting} onClick={() => start((s) => govPauseRequest(s, app, true))}>End the pause…</button>
                        : seated && until === 0 ? <button type="button" className="os-btn os-quiet" disabled={quoting} onClick={() => start((s) => govPauseRequest(s, app, false))}>Pause…</button> : null)
                return (
                    <li key={app} className="os-it">
                        <span className="os-grow"><b>{BRIDGE_APPS[app].label}</b>
                            <span className="os-sub os-block">{!pauses.data ? "…" : !governed ? "Not governed by Memba DAO" : until === 0 ? "Not paused by the DAO" : over ? "Pause over" : `Paused until ${formatChainTime(until)}`}</span></span>
                        {control}
                    </li>
                )
            })}</ul>
        </section>
    )
}
