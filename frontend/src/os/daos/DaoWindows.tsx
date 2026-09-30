/**
 * The DAOs app, a DAO folder window (Overview · Proposals · Members ·
 * Treasury as a target, D19) and a proposal window with voting through the
 * Memba review (D15). Data comes from the classic loaders (useOsDao).
 *
 * @module os/daos/DaoWindows
 */
import { lazy, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { getSavedDAOsForOrg, FEATURED_DAO } from "../../lib/daoSlug"
import { readGovernanceReceipt } from "../../lib/dao/governanceRecovery"
import { invalidateProposalCache } from "../../lib/dao/proposals"
import { hasInvisibleFormatting, revealInvisibleFormatting } from "../../lib/dao/v2Text"
import { canVoteNow, executionState, formatChainTime, relativeTime, V2_STATUS_EXPLANATIONS } from "../../lib/dao/v2Lifecycle"
import { ACTIVE_NETWORK_KEY, DAO_REALM_PATH } from "../../lib/config"
import { shortAddr } from "../shell/format"
import { ThingTile } from "../shell/icons"
import type { DaoSection } from "../shell/osPath"
import type { OsSession } from "../shell/useOsSession"
import { daoSpec, newDaoSpec, specForTarget, type WindowSpec } from "../shell/windows"
import { useSigner } from "../sign/signerContext"
import { daoKindKey, useDaoKind } from "../../hooks/useDaoKind"
import { nameForRealm, realmForName } from "./daoNames"
import { useDaoConfig, useDaoMembers, useDaoProposals, useMyVote, useProposal } from "./useOsDao"
import { voteRequest, voteScope } from "./voteRequest"
import { JoinMembaDao } from "./JoinMembaDao"
import { UnknownOutcome } from "./UnknownOutcome"
import { WeightedDaoFolder } from "./WeightedDaoFolder"
import { WeightedProposalWindow } from "./WeightedProposal"

const ProposeWizard = lazy(() => import("./ProposeWizard").then((m) => ({ default: m.ProposeWizard })))

const DAO_TINT = ["#5B7CFA", "#3D5BE0"] as const

function Loading({ what }: { what: string }) {
    return <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Loading {what}…</span></div>
}

function Failed({ what, retry }: { what: string; retry?: () => void }) {
    return (
        <div className="os-note os-err" role="alert">
            Couldn't load {what}. The network may be busy.{" "}
            {retry && <button type="button" className="os-btn os-quiet os-inline" onClick={retry}>Try again</button>}
        </div>
    )
}

/**
 * The contract probe never answered. The retry re-runs that probe alone, so no
 * other DAO window is disturbed; while it runs the window shows its loading row.
 */
function ContractUnknown({ realmPath }: { realmPath: string }) {
    const queryClient = useQueryClient()
    return <Failed what="this DAO's contract" retry={() => void queryClient.invalidateQueries({ queryKey: daoKindKey(realmPath), exact: true })} />
}

/** Read a DAO's state again. Which contract a realm is never changes, so the kind probes are left alone: a failed re-probe must not take a window down. */
function refreshDaoState(queryClient: QueryClient) {
    return queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "dao" && query.queryKey[1] !== "kind" })
}

/**
 * The proposal windows of the equal-headcount DAO kinds. Their loaders read
 * nothing until the contract is known to be one of theirs. A weighted DAO
 * shows `weighted` instead, or a pointer to its DAO window when it has no
 * window of this kind.
 */
function StandardDaoOnly({ dao, realmPath, what, open, weighted, children }: { dao: string; realmPath: string; what: string; open: (spec: WindowSpec) => void; weighted?: ReactNode; children: ReactNode }) {
    const kind = useDaoKind(realmPath)
    if (kind.loading) return <Loading what={what} />
    if (kind.error) return <ContractUnknown realmPath={realmPath} />
    if (kind.kind === "weighted") {
        return weighted ?? (
            <div className="os-holding">
                <ThingTile icon="folder" tint={DAO_TINT} size={44} />
                <div className="os-holding-title">This DAO votes by points</div>
                <p className="os-sub">Its proposals are in its DAO window, under Proposals.</p>
                <button type="button" className="os-btn" onClick={() => open(daoSpec(dao, "proposals"))}>Open {dao}</button>
            </div>
        )
    }
    return children
}

function NotADao({ name }: { name: string }) {
    return (
        <div className="os-holding">
            <ThingTile icon="folder" tint={DAO_TINT} size={44} />
            <div className="os-holding-title">“{name}” isn't a DAO address</div>
            <p className="os-sub">DAO links look like /os/dao/alice.team, which stands for gno.land/r/alice/team.</p>
        </div>
    )
}

// ── DAOs app ────────────────────────────────────────────────────────────────

export function DaosApp({ open }: { open: (spec: WindowSpec) => void }) {
    const [path, setPath] = useState("")
    const [err, setErr] = useState<string | null>(null)
    const featured = [
        { realmPath: FEATURED_DAO.realmPath, name: FEATURED_DAO.name },
        { realmPath: DAO_REALM_PATH, name: "Memba DAO" },
    ]
    const saved = getSavedDAOsForOrg(null).filter((d) => !featured.some((f) => f.realmPath === d.realmPath))
    const openRealm = (realmPath: string) => {
        const name = nameForRealm(realmPath)
        if (name) open(daoSpec(name))
    }
    const submit = (e: FormEvent) => {
        e.preventDefault()
        const p = path.trim().replace(/^https?:\/\/[^/]+\//, "gno.land/").replace(/\/$/, "")
        const name = nameForRealm(p)
        if (!name) { setErr("Enter a realm path like gno.land/r/alice/team."); return }
        setErr(null)
        open(daoSpec(name))
    }
    const row = (d: { realmPath: string; name: string }) => (
        <li key={d.realmPath}>
            <button type="button" className="os-it os-click" onClick={() => openRealm(d.realmPath)}>
                <ThingTile icon="folder" tint={DAO_TINT} size={30} />
                <span className="os-grow"><b>{d.name}</b><span className="os-sub os-block os-mono">{d.realmPath}</span></span>
            </button>
        </li>
    )
    return (
        <div className="os-stack os-daos">
            <div className="os-row os-end">
                <button type="button" className="os-btn" onClick={() => open(newDaoSpec())}>Create a DAO</button>
            </div>
            <section>
                <h3 className="os-h">Featured</h3>
                <ul className="os-list">{featured.map(row)}</ul>
            </section>
            {saved.length > 0 && (
                <section>
                    <h3 className="os-h">Saved in this browser</h3>
                    <ul className="os-list">{saved.map(row)}</ul>
                </section>
            )}
            <form className="os-stack os-tight" onSubmit={submit}>
                <label className="os-h" htmlFor="os-dao-path">Open a DAO by address</label>
                <div className="os-row os-nowrap">
                    <input id="os-dao-path" className="os-in os-mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="gno.land/r/…" autoComplete="off" spellCheck={false} />
                    <button type="submit" className="os-btn">Open</button>
                </div>
                {err && <span className="os-fe" role="alert">{err}</span>}
            </form>
        </div>
    )
}

// ── DAO folder ──────────────────────────────────────────────────────────────

const TABS: { id: DaoSection; label: string }[] = [
    { id: "overview", label: "Overview" }, { id: "proposals", label: "Proposals" }, { id: "members", label: "Members" }, { id: "treasury", label: "Treasury" },
]

interface DaoFolderProps { name: string; section: DaoSection; open: (spec: WindowSpec) => void; session: OsSession; active?: boolean }

export function DaoFolder(props: DaoFolderProps) {
    const realmPath = realmForName(props.name)
    if (!realmPath) return <NotADao name={props.name} />
    return <DaoFolderBody {...props} realmPath={realmPath} />
}

function DaoFolderBody({ name, realmPath, section, open, session, active }: DaoFolderProps & { realmPath: string }) {
    const kind = useDaoKind(realmPath)
    // The equal-headcount loaders below read nothing until the contract is known to be one of theirs.
    const standard = !kind.loading && !kind.error && kind.kind !== "weighted"
    const config = useDaoConfig(realmPath, standard)
    const proposals = useDaoProposals(realmPath, standard && (section === "proposals" || section === "overview"))
    const members = useDaoMembers(realmPath, config.data?.memberstorePath, standard && section === "members" && !config.isPending)
    const tabs = useRef<Partial<Record<DaoSection, HTMLButtonElement | null>>>({})
    const tabId = (id: DaoSection) => `os-dao-${name}-${id}`
    const panelId = `os-dao-${name}-panel`
    const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, id: DaoSection) => {
        const index = TABS.findIndex((tab) => tab.id === id)
        const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1
            : event.key === "ArrowRight" ? (index + 1) % TABS.length
                : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : -1
        if (next < 0) return
        event.preventDefault()
        const target = TABS[next].id
        open(daoSpec(name, target))
        requestAnimationFrame(() => tabs.current[target]?.focus())
    }
    // Which contract this is decides everything below, so nothing else shows until it is known.
    if (kind.loading) return <Loading what="the DAO contract" />
    const join = name === "memba_dao" && <JoinMembaDao open={open} />
    if (kind.error) {
        return (
            <div className="os-stack">
                <ContractUnknown realmPath={realmPath} />
                {join}
            </div>
        )
    }
    let body: ReactNode
    if (kind.kind === "weighted") body = <WeightedDaoFolder name={name} realmPath={realmPath} section={section} open={open} session={session} active={active} />
    else if (config.isPending) body = <Loading what="the DAO" />
    else if (config.isError) body = <Failed what="this DAO" retry={() => void config.refetch()} />
    else if (!config.data) body = <p className="os-note os-warn">No DAO answers at {realmPath} on this network.</p>
    else if (section === "overview") {
        const c = config.data
        const open3 = (proposals.data ?? []).filter((p) => p.status === "open").slice(0, 3)
        body = (
            <div className="os-stack">
                <div>
                    <div className="os-holding-title">{revealInvisibleFormatting(c.name || name)}</div>
                    {c.description && <p className="os-sub os-pre">{revealInvisibleFormatting(c.description)}</p>}
                </div>
                {c.isArchived && <p className="os-note os-warn">This DAO is archived. It no longer accepts proposals.</p>}
                <dl className="os-kv">
                    <div className="os-kv-row"><dt>Address</dt><dd className="os-mono os-break">{realmPath}</dd></div>
                    <div className="os-kv-row"><dt>Members</dt><dd>{c.memberCount}</dd></div>
                    {c.threshold && <div className="os-kv-row"><dt>Passes with</dt><dd>{c.threshold}</dd></div>}
                </dl>
                <section>
                    <h3 className="os-h">Open proposals</h3>
                    {proposals.isPending ? <Loading what="proposals" /> : proposals.isError ? <Failed what="proposals" retry={() => void proposals.refetch()} /> : open3.length
                        ? <ul className="os-list">{open3.map((p) => (
                            <li key={p.id}><button type="button" className="os-it os-click" onClick={() => open(specForTarget({ kind: "proposal", dao: name, n: p.id })!)}>
                                <ThingTile icon="doc" size={28} /><span className="os-grow"><b>#{p.id} {revealInvisibleFormatting(p.title)}</b></span>
                            </button></li>
                        ))}</ul>
                        : <p className="os-sub">None right now.</p>}
                </section>
            </div>
        )
    } else if (section === "proposals") {
        const newProposal = kind.kind === "memba-v2" ? (
            <div className="os-row os-end">
                <button type="button" className="os-btn" onClick={() => open(specForTarget({ kind: "new-proposal", dao: name })!)}>New proposal</button>
            </div>
        ) : kind.capabilities.propose.length > 0
            ? <p className="os-sub">New proposals for this DAO contract use the <a href={`/${ACTIVE_NETWORK_KEY}/dao/${realmPath}/propose`}>classic proposal form</a>.</p>
            : <p className="os-sub">This DAO contract does not accept new proposals through Memba.</p>
        const list = proposals.isPending ? <Loading what="proposals" /> : proposals.isError ? <Failed what="proposals" retry={() => void proposals.refetch()} /> : (proposals.data ?? []).length === 0
            ? <p className="os-sub">No proposals yet.</p>
            : <ul className="os-list">{(proposals.data ?? []).map((p) => (
                <li key={p.id}><button type="button" className="os-it os-click" onClick={() => open(specForTarget({ kind: "proposal", dao: name, n: p.id })!)}>
                    <ThingTile icon="doc" size={28} />
                    <span className="os-grow"><b>#{p.id} {revealInvisibleFormatting(p.title)}</b><span className="os-sub os-block">{p.status.charAt(0).toUpperCase() + p.status.slice(1)}</span></span>
                </button></li>
            ))}</ul>
        body = <div className="os-stack os-tight">{newProposal}{list}</div>
    } else if (section === "members") {
        body = members.isPending ? <Loading what="members" /> : members.isError ? <Failed what="members" retry={() => void members.refetch()} />
            : <ul className="os-list">{(members.data ?? []).map((m) => (
                <li key={m.address} className="os-it">
                    <span className="os-av" aria-hidden="true">{(m.username || m.address).replace(/^@/, "").slice(0, 1).toUpperCase()}</span>
                    <span className="os-grow"><b>{m.username ? revealInvisibleFormatting(m.username) : shortAddr(m.address)}</b><span className="os-sub os-block os-mono">{m.address}</span></span>
                    <span className="os-sub">{[m.tier, ...m.roles].filter(Boolean).map(revealInvisibleFormatting).join(" · ")}</span>
                </li>
            ))}</ul>
    } else {
        body = (
            <div className="os-card os-stack os-tight">
                <span className="os-tgt">Target · contract v3</span>
                <b>Treasury</b>
                <p className="os-sub os-flush">DAOs on Memba can't hold funds today. Treasury and spend proposals arrive with the next DAO contract.</p>
            </div>
        )
    }
    return (
        <div className="os-folder">
            <div className="os-tabs" role="tablist" aria-label="DAO sections">
                {TABS.map((t) => (
                    <button key={t.id} ref={(node) => { tabs.current[t.id] = node }} id={tabId(t.id)} type="button" role="tab" aria-selected={section === t.id}
                        aria-controls={panelId} tabIndex={section === t.id ? 0 : -1} className="os-tab" onKeyDown={(event) => onTabKey(event, t.id)}
                        onClick={() => open(daoSpec(name, t.id))}>{t.label}</button>
                ))}
            </div>
            <div id={panelId} className="os-folder-body" role="tabpanel" aria-labelledby={tabId(section)} tabIndex={0}>
                {/* One element around the body on every section: switching sections must not remount it (a weighted DAO's open workspace lives in it). */}
                {join ? <div className="os-stack">{body}{section === "overview" && join}</div> : body}
            </div>
        </div>
    )
}

// ── Proposal window ─────────────────────────────────────────────────────────

export function ProposalWindow({ dao, n, session, open }: { dao: string; n: number; session: OsSession; open: (spec: WindowSpec) => void }) {
    const realmPath = realmForName(dao)
    if (!realmPath) return <NotADao name={dao} />
    return (
        <StandardDaoOnly dao={dao} realmPath={realmPath} what={`proposal #${n}`} open={open} weighted={<WeightedProposalWindow realmPath={realmPath} dao={dao} id={String(n)} session={session} />}>
            <ProposalBody dao={dao} realmPath={realmPath} n={n} session={session} />
        </StandardDaoOnly>
    )
}

/** The New proposal wizard, behind the same contract check as the proposal window. */
export function NewProposalWindow({ dao, session, open, close }: { dao: string; session: OsSession; open: (spec: WindowSpec) => void; close: () => void }) {
    const realmPath = realmForName(dao)
    if (!realmPath) return <NotADao name={dao} />
    return <StandardDaoOnly dao={dao} realmPath={realmPath} what="the DAO contract" open={open}><ProposeWizard dao={dao} session={session} open={open} close={close} /></StandardDaoOnly>
}

/** Chain-style seconds, refreshed every 30 s (relative "ends in" times). */
function useNowSeconds(): number {
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
    useEffect(() => {
        const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
        return () => clearInterval(id)
    }, [])
    return now
}

function Bar({ label, value, whole }: { label: string; value: number; whole: number }) {
    const pct = whole > 0 ? Math.min(100, Math.round((value / whole) * 100)) : 0
    return (
        <div className="os-tally">
            <div className="os-row os-between"><span>{label}</span><span className="os-sub">{value} · {pct} %</span></div>
            <div className="os-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
        </div>
    )
}

function ProposalBody({ dao, realmPath, n, session }: { dao: string; realmPath: string; n: number; session: OsSession }) {
    const signer = useSigner()
    const queryClient = useQueryClient()
    const { kind, ...q } = useProposal(realmPath, n)
    const config = useDaoConfig(realmPath)
    const member = session.status === "member"
    const v2 = kind.kind === "memba-v2"
    const members = useDaoMembers(realmPath, config.data?.memberstorePath, member && !config.isPending)
    const myVote = useMyVote(realmPath, n, session.address, v2)
    const [, rerender] = useState(0)
    const now = useNowSeconds()

    // After a signature settles, read the proposal, the tally and my vote again.
    useEffect(() => {
        if (signer.version === 0) return
        invalidateProposalCache(realmPath)
        void refreshDaoState(queryClient)
    }, [signer.version, queryClient, realmPath])

    if (q.isPending) return <Loading what={`proposal #${n}`} />
    if (q.isError) return <Failed what={`proposal #${n}`} retry={() => void q.refetch()} />
    const p = q.data!
    const openNow = p.v2 ? canVoteNow(p.v2, now) : p.open
    const scope = member ? voteScope(realmPath, session.address, n) : null
    const receipt = scope ? readGovernanceReceipt(scope) : null
    const me = members.data?.find((m) => m.address === session.address)
    const invisible = hasInvisibleFormatting(p.title) || hasInvisibleFormatting(p.description)

    let action: ReactNode
    if (!kind.capabilities.vote) action = <p className="os-sub">Memba can't vote on this kind of DAO.</p>
    else if (!member) action = <button type="button" className="os-btn" onClick={session.openConnect}>Connect to vote</button>
    else if (receipt) action = <UnknownOutcome key={JSON.stringify(scope)} scope={scope!} receipt={receipt} attempt="vote" onCleared={() => { rerender((x) => x + 1); void refreshDaoState(queryClient) }} />
    else if (myVote.data?.voted) action = <p className="os-note">{myVote.data.choice === null ? "Your vote is recorded; the choice could not be read right now." : <>You voted <b>{myVote.data.choice === "YES" ? "Yes" : myVote.data.choice === "NO" ? "No" : "Abstain"}</b>. Votes are final.</>}</p>
    else if (!openNow) action = <p className="os-sub">Voting is closed.</p>
    else if (members.isSuccess && !me) action = <p className="os-sub">Only members of this DAO can vote.</p>
    else {
        action = (
            <button type="button" className="os-btn" disabled={!members.isSuccess || !config.isSuccess} onClick={() => signer.sign(voteRequest({
                kind: kind.kind!, realmPath, daoName: config.data?.name || dao, proposal: p, caller: session.address,
                electorateVersion: config.data?.v2?.electorate_version ?? null, power: me?.votingPower || null,
            }))}>Vote…</button>
        )
    }

    return (
        <div className="os-stack">
            <div>
                <div className="os-row os-tight-row"><span className="os-pill">{p.statusLabel}</span><span className="os-sub">{config.data?.name || dao}</span></div>
                <h3 className="os-holding-title">{revealInvisibleFormatting(p.title)}</h3>
                <div className="os-sub">by {p.author.startsWith("g1") ? shortAddr(p.author) : p.author}{p.endsAt && p.v2?.status === "ACTIVE" ? ` · ${openNow ? "voting ends" : "voting period ended"} ${relativeTime(p.endsAt, now)} (${formatChainTime(p.endsAt)})` : ""}</div>
                {p.v2 && !openNow && <p className="os-sub">{p.v2.status === "ACTIVE" ? "The voting deadline has passed. Refresh for the chain's final status." : V2_STATUS_EXPLANATIONS[p.v2.status]}</p>}
            </div>
            {invisible && <p className="os-note os-warn" role="alert">This proposal contains invisible formatting characters, shown as [U+XXXX]. They can make text read differently from what it says.</p>}
            {p.tallyKnown ? (
                <div className="os-stack os-tight">
                    <Bar label="Yes" value={p.yes} whole={p.whole} />
                    <Bar label="No" value={p.no} whole={p.whole} />
                    <Bar label="Abstain" value={p.abstain} whole={p.whole} />
                    <span className="os-sub">{p.unit === "power" ? `Out of ${p.whole} voting power` : `${p.whole} member${p.whole === 1 ? "" : "s"} voted so far`}</span>
                </div>
            ) : <p className="os-sub">The votes couldn't be read right now.</p>}
            <div className="os-vote">{action}</div>
            {p.v2?.status === "ACCEPTED" && (
                <p className="os-note">
                    {executionState(p.v2, now) === "open" ? "This proposal can now be executed. "
                        : executionState(p.v2, now) === "too-early" ? `Execution opens ${relativeTime(p.v2.executable_at, now)}. `
                            : "The execution window has closed. "}
                    <a href={`/${ACTIVE_NETWORK_KEY}/dao/${realmPath}/proposal/${n}`}>
                        {executionState(p.v2, now) === "open" ? "Execute on the DAO page" : "View execution details on the DAO page"}
                    </a>
                </p>
            )}
            {!p.v2 && p.statusLabel === "Passed" && kind.capabilities.execute && (
                <p className="os-note">This proposal passed. A DAO member can execute it on the <a href={`/${ACTIVE_NETWORK_KEY}/dao/${realmPath}/proposal/${n}`}>DAO proposal page</a>.</p>
            )}
            {p.description && (
                <section>
                    <h3 className="os-h">Description</h3>
                    <p className="os-pre">{revealInvisibleFormatting(p.description)}</p>
                </section>
            )}
        </div>
    )
}
