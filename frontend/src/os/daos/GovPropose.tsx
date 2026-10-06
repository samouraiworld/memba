/**
 * Proposing on Memba DAO. A roster action is encoded here; an app action is
 * sent to the bridge, whose Approval read answers with the exact proposal its
 * entrypoint will consume (the app's current state included), so the member
 * reviews what will run, decoded, before signing.
 *
 * @module os/daos/GovPropose
 */
import { useState } from "react"
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { BRIDGE_APPS, BRIDGE_PATH, CLASS_NAMES, decodeGovAction, govNeverRuns } from "../../lib/dao/govActions"
import { BRIDGE_INPUTS, bridgeDraftCall, opsFor, ROSTER_INPUTS, rosterDraft, type GovDraft, type GovInput } from "../../lib/dao/govDrafts"
import { validText } from "../../lib/dao/daoauth"
import { valueText } from "../../lib/dao/govView"
import { MAX_NOTE } from "../../lib/dao/govTx"
import { bridgePublished, readBridgeApproval } from "../../lib/dao/membaGov"
import type { OsSession } from "../shell/useOsSession"
import { useAlive } from "../shell/useAlive"
import { govProposeRequest, govScope } from "./govRequests"
import { useGovSign } from "./useGovSign"

const ROSTER = "roster"

/** A GNOT amount as ugnot, or the text as typed when it is not one (the encoder then refuses it). */
const ugnot = (gnot: string) => {
    const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(gnot.trim())
    return m ? String(BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"))) : gnot
}

function Field({ input, value, set, id }: { input: GovInput; value: string; set: (v: string) => void; id: string }) {
    if (input.tag === "b") return <label className="os-row"><input id={id} type="checkbox" checked={value === "1"} onChange={(e) => set(e.target.checked ? "1" : "0")} /><span>{input.label}</span></label>
    let control
    if (input.options) control = <select id={id} className="os-in" value={value} onChange={(e) => set(e.target.value)}><option value="">Choose…</option>{input.options.map((o) => <option key={o}>{o}</option>)}</select>
    else if (input.kind === "time") {
        control = (
            <div className="os-row">
                <input id={id} className="os-in" type="datetime-local" disabled={value === "0"} onChange={(e) => set(String(Math.floor(new Date(e.target.value).getTime() / 1000)))} />
                <label className="os-row"><input type="checkbox" checked={value === "0"} onChange={(e) => set(e.target.checked ? "0" : "")} /><span>End the pause now</span></label>
            </div>
        )
    } else {
        control = <input id={id} className={`os-in${input.tag === "a" ? " os-mono" : ""}`} value={value} spellCheck={false} autoComplete="off"
            placeholder={input.kind === "ugnot" ? "GNOT" : input.kind === "bps" ? "basis points (100 = 1%)" : undefined} onChange={(e) => set(e.target.value)} />
    }
    return <div className="os-stack os-tight"><label className="os-h" htmlFor={id}>{input.label}</label>{control}</div>
}

export function ProposeForm({ session, onClose }: { session: OsSession; onClose: () => void }) {
    const { quoting, start, lock, failed } = useGovSign(session)
    const alive = useAlive()
    const [what, setWhat] = useState("")
    const [op, setOp] = useState("")
    const [values, setValues] = useState<string[]>([])
    const [note, setNote] = useState("")
    // floor: the lowest class the action allows (the larger of the decoder's and the bridge's answer).
    const [review, setReview] = useState<{ draft: GovDraft; call: string | null; floor: number } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const ops = what === ROSTER ? Object.keys(ROSTER_INPUTS) : what ? opsFor(what) : []
    const inputs = !op ? [] : what === ROSTER ? ROSTER_INPUTS[op].inputs : BRIDGE_INPUTS[op].inputs
    const reset = (next: () => void) => { next(); setReview(null); setError(null) }
    // An unticked box is false: b:0, never an empty value.
    const value = (i: number) => (inputs[i].tag === "b" ? values[i] || "0" : inputs[i].kind === "ugnot" ? ugnot(values[i] ?? "") : values[i] ?? "")

    const check = async () => {
        setBusy(true); setError(null); setReview(null)
        try {
            if (!validText(note) || note.length > MAX_NOTE) throw new Error(`A note is at most ${MAX_NOTE} printable ASCII characters: no curly quotes, accents or line breaks.`)
            const vals = inputs.map((_, i) => value(i))
            if (what === ROSTER) {
                const draft = rosterDraft(op, vals, note)
                if (alive.current) setReview({ draft, call: null, floor: draft.class })
                return
            }
            const call = bridgeDraftCall(op, what, vals)
            const a = await readBridgeApproval({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID }, call)
            const minClass = decodeGovAction(BRIDGE_PATH, a.action, a.args)?.minClass ?? a.class
            if (alive.current) setReview({ draft: { target: BRIDGE_PATH, action: a.action, args: a.args, scope: a.scope, class: Math.max(minClass, a.class), note }, call, floor: Math.max(minClass, a.class) })
        } catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : "This proposal cannot be built.")
        } finally {
            if (alive.current) setBusy(false)
        }
    }

    const decoded = review && decodeGovAction(review.draft.target, review.draft.action, review.draft.args)
    const never = review && decoded ? govNeverRuns(review.draft, decoded) : null
    return (
        <section className="os-card os-stack">
            <div className="os-row os-between"><b>New proposal</b><button type="button" className="os-btn os-quiet" onClick={onClose}>Close</button></div>
            <div className="os-stack os-tight">
                <label className="os-h" htmlFor="gov-what">About</label>
                <select id="gov-what" className="os-in" value={what} onChange={(e) => reset(() => { setWhat(e.target.value); setOp(""); setValues([]) })}>
                    <option value="">Choose…</option>
                    <option value={ROSTER}>Memba DAO's roster</option>
                    {bridgePublished() && Object.entries(BRIDGE_APPS).map(([key, app]) => <option key={key} value={key}>{app.label}</option>)}
                </select>
            </div>
            {what && (
                <div className="os-stack os-tight">
                    <label className="os-h" htmlFor="gov-op">Action</label>
                    <select id="gov-op" className="os-in" value={op} onChange={(e) => reset(() => { setOp(e.target.value); setValues([]) })}>
                        <option value="">Choose…</option>
                        {ops.map((o) => <option key={o} value={o}>{what === ROSTER ? ROSTER_INPUTS[o].title : BRIDGE_INPUTS[o].title}</option>)}
                    </select>
                </div>
            )}
            {inputs.map((input, i) => (
                <Field key={`${op}-${i}`} id={`gov-in-${i}`} input={input} value={values[i] ?? ""}
                    set={(v) => reset(() => setValues((old) => Object.assign([...old], { [i]: v })))} />
            ))}
            {op && (
                <div className="os-stack os-tight">
                    <label className="os-h" htmlFor="gov-note">Your note (optional, shown labelled as yours)</label>
                    <textarea id="gov-note" className="os-in" maxLength={280} value={note} onChange={(e) => reset(() => setNote(e.target.value))} />
                    <button type="button" className="os-btn" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Review"}</button>
                </div>
            )}
            {error && <p className="os-note os-err" role="alert">{error}</p>}
            {failed}
            {review && decoded && (
                <div className="os-stack os-tight">
                    <b>{decoded.title}</b>
                    <dl className="os-kv">{decoded.rows.map((r) => <div key={r.label} className="os-kv-row"><dt>{r.label}</dt><dd className="os-break">{valueText(r.kind, r.value)}</dd></div>)}</dl>
                    {never ? <p className="os-note os-err" role="alert">{never}</p> : (
                        <>
                            <div className="os-row">
                                <span className="os-sub">Class</span>
                                {review.draft.target === BRIDGE_PATH
                                    ? <select aria-label="Class" className="os-in" value={review.draft.class} onChange={(e) => setReview({ ...review, draft: { ...review.draft, class: Number(e.target.value) } })}>
                                        {[1, 2, 3].filter((c) => c >= review.floor).map((c) => <option key={c} value={c}>{CLASS_NAMES[c]}</option>)}
                                    </select>
                                    : <b>{CLASS_NAMES[review.draft.class]} (fixed for roster changes)</b>}
                            </div>
                            {lock(govScope(session.address, `propose:${review.draft.action}`), "proposal") || (
                                <button type="button" className="os-btn" disabled={quoting} onClick={() => start((s) => govProposeRequest(s, review.draft, review.call))}>
                                    {quoting ? "Reading the fee…" : "Propose…"}
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}
        </section>
    )
}
