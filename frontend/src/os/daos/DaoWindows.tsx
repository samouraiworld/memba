/**
 * The DAOs app, a DAO folder window (Overview · Proposals · Members ·
 * Treasury as a target, D19) and a proposal window with voting through the
 * Memba review (D15). Data comes from the classic loaders (useOsDao).
 *
 * @module os/daos/DaoWindows
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { getSavedDAOsForOrg, FEATURED_DAO } from "../../lib/daoSlug"
import { clearGovernanceReceipt, readGovernanceReceipt } from "../../lib/dao/governanceRecovery"
import { hasInvisibleFormatting, revealInvisibleFormatting } from "../../lib/dao/v2Text"
import { formatChainTime, relativeTime } from "../../lib/dao/v2Lifecycle"
import { DAO_REALM_PATH } from "../../lib/config"
import { shortAddr } from "../shell/format"
import { ThingTile } from "../shell/icons"
import type { DaoSection } from "../shell/osPath"
import type { OsSession } from "../shell/useOsSession"
import { daoSpec, newDaoSpec, specForTarget, type WindowSpec } from "../shell/windows"
import { useSigner } from "../sign/signerContext"
import { nameForRealm, realmForName } from "./daoNames"
import { useDaoConfig, useDaoMembers, useDaoProposals, useMyVote, useProposal } from "./useOsDao"
import { voteRequest, voteScope } from "./voteRequest"

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
        <div className="os-stack">
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

export function DaoFolder({ name, section, open }: { name: string; section: DaoSection; open: (spec: WindowSpec) => void }) {
    const realmPath = realmForName(name)
    if (!realmPath) return <NotADao name={name} />
    return <DaoFolderBody name={name} realmPath={realmPath} section={section} open={open} />
}

function DaoFolderBody({ name, realmPath, section, open }: { name: string; realmPath: string; section: DaoSection; open: (spec: WindowSpec) => void }) {
    const config = useDaoConfig(realmPath)
    const proposals = useDaoProposals(realmPath, section === "proposals" || section === "overview")
    const members = useDaoMembers(realmPath, config.data?.memberstorePath, section === "members" && !config.isPending)
    let body: ReactNode
    if (config.isPending) body = <Loading what="the DAO" />
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
                    {proposals.isPending ? <Loading what="proposals" /> : open3.length
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
        const newProposal = (
            <div className="os-row os-end">
                <button type="button" className="os-btn" onClick={() => open(specForTarget({ kind: "new-proposal", dao: name })!)}>New proposal</button>
            </div>
        )
        const list = proposals.isPending ? <Loading what="proposals" /> : proposals.isError ? <Failed what="proposals" retry={() => void proposals.refetch()} /> : (proposals.data ?? []).length === 0
            ? <p className="os-sub">No proposals yet.</p>
            : <ul className="os-list">{(proposals.data ?? []).map((p) => (
                <li key={p.id}><button type="button" className="os-it os-click" onClick={() => open(specForTarget({ kind: "proposal", dao: name, n: p.id })!)}>
                    <ThingTile icon="doc" size={28} />
                    <span className="os-grow"><b>#{p.id} {revealInvisibleFormatting(p.title)}</b><span className="os-sub os-block">{p.status} · {p.yesVotes} yes · {p.noVotes} no</span></span>
                </button></li>
            ))}</ul>
        body = <div className="os-stack os-tight">{newProposal}{list}</div>
    } else if (section === "members") {
        body = members.isPending ? <Loading what="members" /> : members.isError ? <Failed what="members" retry={() => void members.refetch()} />
            : <ul className="os-list">{(members.data ?? []).map((m) => (
                <li key={m.address} className="os-it">
                    <span className="os-av" aria-hidden="true">{(m.username || m.address).replace(/^@/, "").slice(0, 1).toUpperCase()}</span>
                    <span className="os-grow"><b>{m.username || shortAddr(m.address)}</b><span className="os-sub os-block os-mono">{m.address}</span></span>
                    <span className="os-sub">{[m.tier, ...m.roles].filter(Boolean).join(" · ")}</span>
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
                    <button key={t.id} type="button" role="tab" aria-selected={section === t.id} className="os-tab" onClick={() => open(daoSpec(name, t.id))}>{t.label}</button>
                ))}
            </div>
            <div className="os-folder-body" role="tabpanel">{body}</div>
        </div>
    )
}

// ── Proposal window ─────────────────────────────────────────────────────────

export function ProposalWindow({ dao, n, session }: { dao: string; n: number; session: OsSession }) {
    const realmPath = realmForName(dao)
    if (!realmPath) return <NotADao name={dao} />
    return <ProposalBody dao={dao} realmPath={realmPath} n={n} session={session} />
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
    const [checked, setChecked] = useState(false)
    const [, rerender] = useState(0)
    const now = useNowSeconds()

    // After a signature settles, read the proposal, the tally and my vote again.
    useEffect(() => {
        if (signer.version === 0) return
        void queryClient.invalidateQueries({ queryKey: ["dao"] })
    }, [signer.version, queryClient])

    if (kind.loading || q.isPending) return <Loading what={`proposal #${n}`} />
    if (kind.error || q.isError) return <Failed what={`proposal #${n}`} retry={() => void q.refetch()} />
    const p = q.data!
    const scope = member ? voteScope(realmPath, session.address, n) : null
    const receipt = scope ? readGovernanceReceipt(scope) : null
    const me = members.data?.find((m) => m.address === session.address)
    const invisible = hasInvisibleFormatting(p.title) || hasInvisibleFormatting(p.description)

    let action: ReactNode
    if (!kind.capabilities.vote) action = <p className="os-sub">Memba can't vote on this kind of DAO.</p>
    else if (!member) action = <button type="button" className="os-btn" onClick={session.openConnect}>Connect to vote</button>
    else if (receipt) {
        action = (
            <div className="os-note os-warn os-stack os-tight" role="status">
                <b>Outcome unknown.</b>
                <span>A previous vote attempt is saved. Check its outcome before voting again.</span>
                {receipt.hash && <code className="os-mono os-break">Transaction {receipt.hash}</code>}
                <label className="os-ack"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the transaction and want to review this vote again.</label>
                <button type="button" className="os-btn os-quiet" disabled={!checked} onClick={() => {
                    try { clearGovernanceReceipt(scope!); setChecked(false); rerender((x) => x + 1); void queryClient.invalidateQueries({ queryKey: ["dao"] }) } catch { /* a request is still in flight */ }
                }}>Review the vote again</button>
            </div>
        )
    } else if (myVote.data?.voted) action = <p className="os-note">You voted <b>{myVote.data.choice === "YES" ? "Yes" : myVote.data.choice === "NO" ? "No" : "Abstain"}</b>. Votes are final.</p>
    else if (!p.open) action = <p className="os-sub">Voting is closed.</p>
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
                <div className="os-sub">by {p.author.startsWith("g1") ? shortAddr(p.author) : p.author}{p.endsAt ? ` · ${p.open ? "voting ends" : "voting ended"} ${relativeTime(p.endsAt, now)} (${formatChainTime(p.endsAt)})` : ""}</div>
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
            {p.description && (
                <section>
                    <h3 className="os-h">Description</h3>
                    <p className="os-pre">{revealInvisibleFormatting(p.description)}</p>
                </section>
            )}
        </div>
    )
}
