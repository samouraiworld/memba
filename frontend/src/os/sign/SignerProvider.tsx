/**
 * The signing layer's UI: the review sheet (D15), the "Adena should show"
 * checklist, the wrong-network block, and the transaction tray (pending count
 * in the menu bar, results in the notifications panel; browser-only, D28).
 *
 * @module os/sign/SignerProvider
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import type { OsSession } from "../shell/useOsSession"
import { adenaChecklist, type SignRow } from "./decode"
import { executeSignature, verifyWithRetries, type SettledOutcome, type SignRequest } from "./signer"
import { SignerContext, type SignerApi, type TxNotice } from "./signerContext"

type Stage = "review" | "checking" | "wallet"

interface Review {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- requests carry their own choice type
    req: SignRequest<any>
    choice: string | undefined
    acked: boolean[]
    stage: Stage
    error: string | null
}

let seq = 0

export function SignerProvider({ session, toast, children }: { session: OsSession; toast: (msg: string) => void; children: ReactNode }) {
    const [review, setReview] = useState<Review | null>(null)
    const [pending, setPending] = useState<{ id: number; label: string }[]>([])
    const [notices, setNotices] = useState<TxNotice[]>([])
    const [unread, setUnread] = useState(0)
    const [version, setVersion] = useState(0)
    const busy = useRef(false)

    const notify = useCallback((n: Omit<TxNotice, "id">) => {
        setNotices((list) => [{ ...n, id: ++seq }, ...list].slice(0, 30))
        setUnread((u) => u + 1)
    }, [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- requests carry their own choice type
    const sign = useCallback((req: SignRequest<any>) => {
        if (session.status !== "member") { session.openConnect(); return }
        if (busy.current) { toast("Finish the signature that's open first."); return }
        setReview({ req, choice: req.choice?.initial, acked: (req.acks ?? []).map(() => false), stage: "review", error: null })
    }, [session, toast])

    const settle = useCallback((req: SignRequest<string>, choice: string | undefined, outcome: SettledOutcome) => {
        setVersion((v) => v + 1)
        req.onSettled?.(outcome, choice)
    }, [])

    const go = useCallback(async () => {
        if (!review || busy.current) return
        const { req, choice } = review
        let msgs
        try { msgs = req.prepare(choice).msgs } catch (err) {
            setReview((r) => r && { ...r, error: err instanceof Error ? err.message : String(err) })
            return
        }
        busy.current = true
        setReview((r) => r && { ...r, stage: "checking", error: null })
        const label = req.label(choice)
        const res = await executeSignature(req, choice, msgs, () => setReview((r) => r && { ...r, stage: "wallet" }))
        busy.current = false
        if (res.outcome === "failed" || res.outcome === "cancelled") {
            if (res.outcome === "cancelled") { setReview(null); toast(res.error); settle(req, choice, "cancelled"); return }
            setReview((r) => r && { ...r, stage: "review", error: res.error })
            return
        }
        setReview(null)
        if (res.outcome === "unknown") {
            notify({ kind: "warn", title: `Outcome unknown · ${label}`, sub: "Check before trying again." })
            toast(`Outcome unknown: ${label}. Check before retrying.`)
            settle(req, choice, "unknown")
            return
        }
        if (res.outcome !== "sent") return
        const hash = res.hash
        const id = ++seq
        setPending((p) => [...p, { id, label }])
        // Without a way to read the result back (older DAOs), "sent" is all we can say.
        const ok = req.verify ? await verifyWithRetries(() => req.verify!(choice, hash)) : null
        setPending((p) => p.filter((x) => x.id !== id))
        const where = `${session.network.chainId} · ${hash.slice(0, 10)}…`
        notify(ok === true
            ? { kind: "ok", title: `Confirmed · ${label}`, sub: where }
            : ok === null
                ? { kind: "ok", title: `Sent · ${label}`, sub: where }
                : { kind: "warn", title: `Submitted · ${label}`, sub: "The chain hasn't shown it yet. Don't send it again." })
        if (ok === false) toast(`Submitted: ${label}. Not visible on chain yet.`)
        settle(req, choice, ok === true ? "confirmed" : "submitted")
    }, [review, notify, toast, settle, session.network.chainId])

    const cancel = useCallback(() => {
        if (review?.stage === "checking" || review?.stage === "wallet") return // the wallet request is in flight
        setReview(null)
    }, [review])

    const api = useMemo<SignerApi>(() => ({
        sign, pending, notices, unread, version, markRead: () => setUnread(0),
    }), [sign, pending, notices, unread, version])

    return (
        <SignerContext.Provider value={api}>
            {children}
            {review && (
                <ReviewSheet review={review} session={session} onChoice={(c) => setReview((r) => r && { ...r, choice: c, error: null })}
                    onAck={(i, v) => setReview((r) => r && { ...r, acked: r.acked.map((a, j) => (j === i ? v : a)) })}
                    onGo={() => { void go() }} onCancel={cancel} />
            )}
        </SignerContext.Provider>
    )
}

function Rows({ rows }: { rows: readonly SignRow[] }) {
    return (
        <dl className="os-kv">
            {rows.map((r, i) => (
                <div key={i} className="os-kv-row"><dt>{r.label}</dt><dd className={r.mono ? "os-mono os-break" : undefined}>{r.value}</dd></div>
            ))}
        </dl>
    )
}

function ReviewSheet({ review, session, onChoice, onAck, onGo, onCancel }: {
    review: Review
    session: OsSession
    onChoice: (c: string) => void
    onAck: (i: number, v: boolean) => void
    onGo: () => void
    onCancel: () => void
}) {
    const { req, choice, stage, error } = review
    const chain = session.network.chainId
    const wrongNet = !!session.walletChainId && session.walletChainId !== chain
    let checklist: SignRow[] = []
    let prepareError: string | null = null
    try { checklist = adenaChecklist(req.prepare(choice).msgs, chain) } catch (err) { prepareError = err instanceof Error ? err.message : String(err) }
    const allAcked = review.acked.every(Boolean)
    const canGo = stage === "review" && !wrongNet && !prepareError && allAcked

    return (
        <div className="os-scrim os-scrim-center">
            <div className="os-review os-glass" role="dialog" aria-modal="true" aria-label={`Review · ${req.title}`}
                onKeyDown={(e) => { if (e.key === "Escape") onCancel() }}>
                {stage === "review" && (
                    <>
                        <div className="os-rvh">
                            <div className="os-mhd os-flush">Review · {req.title}</div>
                            <h2 className="os-rv-title">{req.summary}</h2>
                            {req.sub && <div className="os-sub">{req.sub}</div>}
                        </div>
                        <div className="os-rvb">
                            {req.choice && (
                                <div className="os-segm" role="radiogroup" aria-label={req.choice.label}>
                                    {req.choice.options.map((o) => (
                                        <button key={o} type="button" role="radio" aria-checked={choice === o} onClick={() => onChoice(o)}>{o}</button>
                                    ))}
                                </div>
                            )}
                            <Rows rows={req.lines(choice).map(([label, value]) => ({ label, value }))} />
                            {(req.warns ?? []).map((w, i) => <p key={i} className="os-note os-warn">{w}</p>)}
                            {(req.acks ?? []).map((a, i) => (
                                <label key={i} className="os-ack"><input type="checkbox" checked={review.acked[i]} onChange={(e) => onAck(i, e.target.checked)} /> {a}</label>
                            ))}
                            <details className="os-card os-adena" open>
                                <summary>Adena should show</summary>
                                {prepareError ? <p className="os-note os-err">{prepareError}</p> : <Rows rows={checklist} />}
                            </details>
                            {wrongNet && (
                                <p className="os-note os-err" role="alert">Adena is on {session.walletChainId}, but Memba is on {chain}. Switch Adena to {chain} before signing.</p>
                            )}
                            {error && <p className="os-note os-err" role="alert">{error}</p>}
                            {req.note && <p className="os-sub os-flush">{req.note}</p>}
                            <p className="os-sub os-flush">Next, Adena opens. Check it shows the same details.</p>
                        </div>
                        <div className="os-rvf">
                            <button type="button" className="os-btn os-quiet" onClick={onCancel}>Cancel</button>
                            {wrongNet
                                ? <button type="button" className="os-btn" onClick={() => { void session.switchWallet() }}>Switch Adena to {chain}</button>
                                : <button type="button" className="os-btn" onClick={onGo} disabled={!canGo} autoFocus>Sign in Adena</button>}
                        </div>
                    </>
                )}
                {stage !== "review" && (
                    <>
                        <div className="os-rvh">
                            <div className="os-row"><span className="os-spin" aria-hidden="true" /><h2 className="os-rv-title">{stage === "checking" ? "Checking before you sign…" : "Confirm in Adena"}</h2></div>
                            <div className="os-sub">{stage === "checking" ? "Memba re-reads the chain so what you sign still applies." : "Adena opened in its own window. Check it shows:"}</div>
                        </div>
                        {stage === "wallet" && (
                            <div className="os-rvb">
                                <Rows rows={checklist} />
                                <p className="os-sub os-flush">If anything differs, reject it in Adena.</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
