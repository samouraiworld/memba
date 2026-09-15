import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useOutletContext, useParams } from "react-router-dom"
import { NETWORKS, GNO_CHAIN_ID, GNO_RPC_URL } from "../lib/config"
import { assertWeightedWrites, buildWeightedMessage, readWeightedProposal, readWeightedSnapshot, type WeightedAction, type WeightedContext, type WeightedProposal } from "../lib/dao/weighted"
import { doContractBroadcast } from "../lib/grc20"
import type { LayoutContext } from "../types/layout"
import "./weighteddao.css"

type Snapshot = Awaited<ReturnType<typeof readWeightedSnapshot>>

/** Separate route: the weighted host is not a legacy equal-headcount DAO. */
export function WeightedDAO() {
    const { "*": realmPath = "", network = "" } = useParams()
    const { adena, auth } = useOutletContext<LayoutContext>()
    const selected = NETWORKS[network]
    if (!selected) return <p role="alert">Select a supported network.</p>
    const ctx = { realmPath, rpcUrl: selected.rpcUrl, chainId: selected.chainId }
    return <WeightedWorkspace key={`${network}:${realmPath}:${adena.address}:${adena.chainId}:${adena.connected}:${auth.address}:${auth.isAuthenticated}`} ctx={ctx} wallet={adena} authenticated={auth.isAuthenticated && auth.address === adena.address} />
}

function WeightedWorkspace({ ctx, wallet, authenticated }: { ctx: WeightedContext; wallet: LayoutContext["adena"]; authenticated: boolean }) {
    const [data, setData] = useState<Snapshot | null>(null)
    const [before, setBefore] = useState("0")
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [target, setTarget] = useState("")
    const [role, setRole] = useState<"admin" | "finance">("admin")
    const [grant, setGrant] = useState(true)
    const active = useRef(false)
    const operation = useRef(false)
    const request = useRef(0)
    const { rpcUrl, chainId, realmPath } = ctx
    useLayoutEffect(() => { active.current = true; return () => { active.current = false } }, [])
    const refresh = useCallback(async (cursor: string, signal?: AbortSignal) => {
        const ticket = ++request.current
        setLoading(true); setError(""); setData(null)
        try {
            const fresh = await readWeightedSnapshot({ rpcUrl, chainId, realmPath }, cursor, signal)
            if (active.current && ticket === request.current) { setData(fresh); setBefore(cursor) }
        } catch (err) {
            if (active.current && ticket === request.current) setError(err instanceof Error && err.name !== "ZodError" ? err.message : "Could not validate weighted governance data. Confirm the realm supports this DAO version, then refresh.")
        } finally { if (active.current && ticket === request.current) setLoading(false) }
    }, [rpcUrl, chainId, realmPath])
    useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => { if (!controller.signal.aborted) return refresh("0", controller.signal) }); return () => controller.abort() }, [refresh])
    const member = data?.members.find(m => m.address === wallet.address)
    const canAct = !!member && wallet.connected && authenticated && wallet.chainId === chainId && chainId === GNO_CHAIN_ID && rpcUrl === GNO_RPC_URL && chainId !== "gnoland-1" && !busy && !loading
    const submit = async (action: WeightedAction) => {
        if (operation.current || !canAct) return
        operation.current = true; setBusy(true); setError(""); setNotice("")
        const location = window.location.pathname
        const assertCurrent = () => {
            if (!active.current || window.location.pathname !== location || !wallet.connected || !authenticated) throw new Error("Wallet or page changed; prepare the action again")
            assertWeightedWrites(chainId, GNO_CHAIN_ID, wallet.chainId)
            if (rpcUrl !== GNO_RPC_URL) throw new Error("Selected RPC changed")
        }
        try {
            assertCurrent()
            const fresh = await readWeightedSnapshot(ctx)
            assertCurrent()
            if (!fresh.members.some(m => m.address === wallet.address)) throw new Error("Only current DAO members can act")
            if (action.type === "propose") {
                const subject = fresh.members.find(m => m.address === action.target)
                if (!subject || subject[action.role] === action.grant) throw new Error("Select a role change for a current member")
                if (action.role === "admin" && !action.grant && fresh.members.filter(m => m.admin).length === 1) throw new Error("Grant a replacement admin before removing the last admin")
            } else {
                const proposal = await readWeightedProposal(ctx, action.id)
                assertCurrent()
                if (action.type === "execute" ? !proposal.ready : proposal.votingClosed || ["EXECUTED", "INVALIDATED", "EXPIRED"].includes(proposal.status)) throw new Error("Proposal state changed; refresh before acting")
            }
            const result = await doContractBroadcast([buildWeightedMessage(wallet.address, realmPath, action)], action.type === "propose" ? `Propose ${action.grant ? "grant" : "removal"} of ${action.role}: ${action.target}` : `${action.type} weighted proposal ${action.id}`, { retry: false, beforeSign: assertCurrent })
            assertCurrent()
            if (!/^[a-f0-9]{64}$/i.test(result.hash)) throw new Error("Wallet returned no valid transaction hash; check chain state before trying again")
            setNotice(`Transaction submitted: ${result.hash}. Verify its result in the refreshed proposal list.`)
            await refresh("0")
        } catch (err) {
            if (active.current) setError(`${err instanceof Error ? err.message : "Action failed"}. No automatic retry. Refresh chain state before trying again.`)
        } finally { operation.current = false; if (active.current) setBusy(false) }
    }
    return <div className="weighted-dao">
        <header><p className="weighted-dao__eyebrow">Founding governance</p><h1>Memba weighted DAO</h1><p className="weighted-dao__path">{realmPath}</p><p>{chainId} · Role governance</p></header>
        <section className="k-card" aria-labelledby="weighted-policy"><h2 id="weighted-policy">How decisions pass</h2>
            <p>7 people · 8 voting points. The founder has 2 points; each of the six developers has 1.</p>
            <p>Role changes require <strong>6 points and at least 4 people, then 24 hours</strong>, or <strong>5 developers, then 72 hours</strong>.</p>
            <p>Voting lasts 7 days. Proposals qualified before closing retain their execution delay. Every executed role change invalidates other outstanding proposals.</p>
            <p>Admin and finance labels do not add voting power or exclusive execution rights.</p>
        </section>
        {chainId === "gnoland-1" && <p role="status">Mainnet governance is read-only while launch verification is unfinished.</p>}
        <p>Member replacement, migration, treasury spending and application actions are not available in this DAO version.</p>
        <button disabled={loading || busy} onClick={() => void refresh("0")}>Refresh chain state</button>
        {loading && <p role="status">Reading governance state…</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status" className="weighted-dao__path">{notice}</p>}
        {data && <>
            <section aria-labelledby="weighted-members"><h2 id="weighted-members">Members and roles</h2><ul className="weighted-dao__members">{data.members.map(m => <li className="k-card" key={m.address}>
                <strong>{m.personId}</strong><span>{m.founder ? "Founder" : "Core developer"} · {m.weight} {m.weight === 1 ? "point" : "points"}</span>
                <code>{m.address}</code><span>{[m.admin && "Admin", m.finance && "Finance"].filter(Boolean).join(" · ") || "No admin or finance role"}</span>
            </li>)}</ul></section>
            <section className="k-card" aria-labelledby="weighted-propose"><h2 id="weighted-propose">Propose a role change</h2>
                {!canAct && !busy && <p>Actions require a connected, authenticated member on the selected test network.</p>}
                <form onSubmit={e => { e.preventDefault(); void submit({ type: "propose", target, role, grant }) }}><fieldset disabled={!canAct}>
                    <label>Member<select value={target} onChange={e => setTarget(e.target.value)} required><option value="">Choose a member</option>{data.members.map(m => <option key={m.address} value={m.address}>{m.personId} — {m.address}</option>)}</select></label>
                    <label>Role<select value={role} onChange={e => setRole(e.target.value as "admin" | "finance")}><option value="admin">Admin</option><option value="finance">Finance</option></select></label>
                    <label>Change<select value={String(grant)} onChange={e => setGrant(e.target.value === "true")}><option value="true">Grant role</option><option value="false">Remove role</option></select></label>
                    <button type="submit" disabled={!target}>Review role proposal</button>
                </fieldset></form>
            </section>
            <section aria-labelledby="weighted-proposals"><h2 id="weighted-proposals">Role proposals</h2><p>{data.page.total} proposals recorded</p>
                {data.page.proposals.length === 0 && <p>No proposals on this page.</p>}
                {data.page.proposals.map(p => <Proposal key={p.id} proposal={p} canAct={canAct} submit={submit} />)}
                <div className="weighted-dao__actions">{before !== "0" && <button disabled={loading || busy} onClick={() => void refresh("0")}>Newest proposals</button>}{data.page.nextBefore && <button disabled={loading || busy} onClick={() => void refresh(data.page.nextBefore!)}>Older proposals</button>}</div>
            </section>
        </>}
    </div>
}

function Proposal({ proposal: p, canAct, submit }: { proposal: WeightedProposal; canAct: boolean; submit: (action: WeightedAction) => Promise<void> }) {
    const voteOpen = !p.votingClosed && !["EXECUTED", "INVALIDATED", "EXPIRED"].includes(p.status)
    return <article className="k-card weighted-dao__proposal" aria-label={`Proposal ${p.id}`}>
        <h3>#{p.id} · {p.action.grant ? "Grant" : "Remove"} {p.action.role}</h3><p className="weighted-dao__path">Target: {p.action.target}</p><p className="weighted-dao__path">Proposed by: {p.proposer}</p>
        <strong>{p.status}</strong><p>{p.talliesAvailable ? `${p.weightYes} ${p.weightYes === 1 ? "point" : "points"} · ${p.peopleYes} ${p.peopleYes === 1 ? "person" : "people"} · ${p.developersYes} ${p.developersYes === 1 ? "developer" : "developers"} voting yes` : "Historical vote totals are unavailable."}</p>
        <p>Voting closes: <time dateTime={p.votingDeadline}>{p.votingDeadline}</time>{p.votingClosed ? " (closed)" : ""}</p>
        {p.weightedAfter && <p>Weighted route matures: <time dateTime={p.weightedAfter}>{p.weightedAfter}</time></p>}
        {p.developerAfter && <p>Developer route matures: <time dateTime={p.developerAfter}>{p.developerAfter}</time></p>}
        <div className="weighted-dao__actions">{(["yes", "no", "abstain"] as const).map(vote => <button key={vote} disabled={!canAct || !voteOpen} onClick={() => void submit({ type: "vote", id: p.id, vote })}>Vote {vote}</button>)}<button disabled={!canAct || !p.ready} onClick={() => void submit({ type: "execute", id: p.id })}>Execute proposal</button></div>
    </article>
}
