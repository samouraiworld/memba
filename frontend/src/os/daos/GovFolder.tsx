/**
 * Memba DAO on memba_gov in its DAO folder window: how it decides, who sits
 * on it, who is invited, and its proposals. Everything is read from the
 * realm's own JSON (lib/dao/membaGov); a guest sees all of it.
 *
 * @module os/daos/GovFolder
 */
import { useState } from "react"
import { GNO_CHAIN_ID } from "../../lib/config"
import { CLASS_NAMES, GOV_PATH } from "../../lib/dao/govActions"
import { classRules, GOV_STATUS_TEXT, govProposalTitle, govReadError, rosterRules, votingRules } from "../../lib/dao/govView"
import type { GovProposal, GovSnapshot } from "../../lib/dao/membaGov"
import { formatChainTime } from "../../lib/dao/v2Lifecycle"
import { ErrorState, Loading, Pill, type PillTone } from "../kit"
import { ThingTile } from "../shell/icons"
import type { DaoSection } from "../shell/osPath"
import type { OsSession } from "../shell/useOsSession"
import { daoSpec, specForTarget, type WindowSpec } from "../shell/windows"
import { FolderTabs } from "./FolderTabs"
import { EmergencyPauses, JoinAction } from "./GovActions"
import { ProposeForm } from "./GovPropose"
import { useGovSnapshot } from "./useGovDao"

const TABS: { id: DaoSection; label: string }[] = [{ id: "overview", label: "Overview" }, { id: "proposals", label: "Proposals" }, { id: "members", label: "Members" }]

const STATUS_TONE: Partial<Record<GovProposal["status"], PillTone>> = { ready: "ok", timelocked: "warn", executed: "neutral", invalidated: "neutral", expired: "neutral" }

export function GovStatusPill({ status }: { status: GovProposal["status"] }) {
    return <Pill tone={STATUS_TONE[status]}>{GOV_STATUS_TEXT[status]}</Pill>
}

const isOpen = (p: GovProposal) => p.status === "voting" || p.status === "timelocked" || p.status === "ready"

interface Props { name: string; section: DaoSection; open: (spec: WindowSpec) => void; session: OsSession }

/** Shown, without any read, where memba_gov's publication is not recorded. */
export function GovNotPublished() {
    return (
        <div className="os-holding">
            <ThingTile icon="folder" size={44} />
            <div className="os-holding-title">Memba DAO's new governance is not on {GNO_CHAIN_ID}</div>
            <p className="os-sub">Its contract, {GOV_PATH}, is not published on this network yet.</p>
        </div>
    )
}

export function GovFolder({ name, section, open, session }: Props) {
    const [before, setBefore] = useState("0")
    const snapshot = useGovSnapshot(section === "proposals" ? before : "0")
    const data = snapshot.data
    const tab = TABS.some((t) => t.id === section) ? section : "overview"
    return (
        <FolderTabs name={name} tabs={TABS} section={tab} open={open}>
            {!data ? (snapshot.isError ? <ErrorState message={govReadError(snapshot.error)} onRetry={() => void snapshot.refetch()} /> : <Loading label="Reading Memba DAO…" />) : (
                <>
                    {/* A later read that fails leaves the previous one on screen, and says so. */}
                    {snapshot.isError && <ErrorState message={`${govReadError(snapshot.error)} This is the previous read.`} onRetry={() => void snapshot.refetch()} />}
                    {tab === "proposals" ? <Proposals data={data} name={name} open={open} session={session} older={(id) => setBefore(id)} newest={() => setBefore("0")} />
                        : tab === "members" ? <Members data={data} />
                            : <Overview data={data} name={name} open={open} session={session} />}
                </>
            )}
        </FolderTabs>
    )
}

function Row({ p, name, open }: { p: GovProposal; name: string; open: (spec: WindowSpec) => void }) {
    return (
        <button type="button" className="os-it os-click" onClick={() => open(specForTarget({ kind: "proposal", dao: name, n: Number(p.id) })!)}>
            <ThingTile icon="doc" size={28} />
            <span className="os-grow"><b>#{p.id} {govProposalTitle(p)}</b><span className="os-sub os-block">{CLASS_NAMES[p.class]} · by {p.proposer}</span></span>
            <GovStatusPill status={p.status} />
        </button>
    )
}

/** What the connected account is to the DAO; a guest gets nothing here. */
function Seat({ data, session }: { data: GovSnapshot; session: OsSession }) {
    if (session.status !== "member") return null
    const me = data.roster.members.find((m) => m.address === session.address)
    const invited = data.roster.invitations.find((i) => i.address === session.address)
    if (me) return <p className="os-note">You sit as <b>{me.id}</b>, weight {me.weight}.</p>
    if (invited) return <p className="os-note">This address is invited as <b>{invited.id}</b> until {formatChainTime(Number(invited.expires))}. It counts once it signs Join.</p>
    return <p className="os-note">This address holds no seat.</p>
}

function Overview({ data, name, open, session }: { data: GovSnapshot; name: string; open: (spec: WindowSpec) => void; session: OsSession }) {
    const openNow = data.page.proposals.filter(isOpen)
    return (
        <div className="os-stack">
            <div>
                <div className="os-holding-title">Memba DAO</div>
                <p className="os-sub os-mono os-break os-flush">{GOV_PATH}</p>
                <p className="os-sub os-flush">{data.roster.persons} seated, total weight {data.roster.weight} · {GNO_CHAIN_ID}</p>
            </div>
            <Seat data={data} session={session} />
            <JoinAction roster={data.roster} session={session} />
            <section>
                <h3 className="os-h">How decisions pass</h3>
                <ul className="os-list">{classRules(data.constants).map((c) => (
                    <li key={c.name} className="os-it os-top"><span className="os-grow"><b>{c.name}</b><span className="os-sub os-block">Passes with {c.rule}.</span></span></li>
                ))}</ul>
                <p className="os-sub">{votingRules(data.constants)} Each app sets the lowest class its actions need; a proposer may only file higher.</p>
                <p className="os-sub">{rosterRules(data.constants)}</p>
            </section>
            <section>
                <h3 className="os-h">Open proposals</h3>
                <p className="os-sub">{data.page.total === "0" ? "None: no proposal has been filed yet." : `${openNow.length || "None"} open among the latest ${data.page.proposals.length} of ${data.page.total}.`}</p>
                {openNow.length > 0 && <ul className="os-list">{openNow.slice(0, 3).map((p) => <li key={p.id}><Row p={p} name={name} open={open} /></li>)}</ul>}
                {data.page.total !== "0" && <button type="button" className="os-btn os-quiet" onClick={() => open(daoSpec(name, "proposals"))}>All proposals</button>}
            </section>
            <EmergencyPauses roster={data.roster} session={session} />
        </div>
    )
}

function Proposals({ data, name, open, session, older, newest }: { data: GovSnapshot; name: string; open: (spec: WindowSpec) => void; session: OsSession; older: (before: string) => void; newest: () => void }) {
    const [composing, setComposing] = useState(false)
    const list = data.page.proposals
    const last = list.at(-1)
    const seated = session.status === "member" && data.roster.members.some((m) => m.address === session.address)
    return (
        <div className="os-stack os-tight">
            {composing ? <ProposeForm session={session} onClose={() => setComposing(false)} />
                : session.status !== "member" ? <button type="button" className="os-btn" onClick={session.openConnect}>Connect to propose</button>
                    : seated ? <button type="button" className="os-btn" onClick={() => setComposing(true)}>New proposal…</button>
                        : <p className="os-sub">Only seated members propose.</p>}
            {list.length === 0 ? <p className="os-sub">No proposals yet.</p> : <ul className="os-list">{list.map((p) => <li key={p.id}><Row p={p} name={name} open={open} /></li>)}</ul>}
            <div className="os-row">
                {list[0] && list[0].id !== data.page.total && <button type="button" className="os-btn os-quiet" onClick={newest}>Newest</button>}
                {last && last.id !== "1" && <button type="button" className="os-btn os-quiet" onClick={() => older(last.id)}>Older</button>}
            </div>
        </div>
    )
}

/** Open invitations: the realm leaves out lapsed ones. */
function Members({ data }: { data: GovSnapshot }) {
    const invitations = data.roster.invitations
    return (
        <div className="os-stack">
            <ul className="os-list">{data.roster.members.map((m) => (
                <li key={m.id} className="os-it">
                    <span className="os-av" aria-hidden="true">{m.id.slice(0, 1).toUpperCase()}</span>
                    <span className="os-grow"><b>{m.id}</b><span className="os-sub os-block os-mono os-break">{m.address}</span></span>
                    <span className="os-sub">weight {m.weight} · active {formatChainTime(Number(m.lastActive))}</span>
                </li>
            ))}</ul>
            <section>
                <h3 className="os-h">Invitations</h3>
                {invitations.length === 0 ? <p className="os-sub">None open.</p> : <ul className="os-list">{invitations.map((i) => {
                    const recovery = data.roster.members.some((m) => m.id === i.id)
                    return (
                        <li key={i.id} className="os-it">
                            <span className="os-grow"><b>{i.id}</b><span className="os-sub os-block os-mono os-break">{i.address}</span></span>
                            <span className="os-sub">{recovery ? "new key for a seated member" : `weight ${i.weight}`} · until {formatChainTime(Number(i.expires))}</span>
                        </li>
                    )
                })}</ul>}
                <p className="os-sub">An invited key counts only once it signs Join from its own account.</p>
            </section>
        </div>
    )
}
