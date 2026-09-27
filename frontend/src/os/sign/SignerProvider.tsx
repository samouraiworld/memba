/**
 * The signing layer's UI: the review sheet (D15), the "Adena should show"
 * checklist, the wrong-network block, and the transaction tray (pending count
 * in the menu bar, results in the notifications panel; browser-only, D28).
 *
 * @module os/sign/SignerProvider
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { beginWalletActivity } from "../../lib/walletActivity"
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
    const reviewOpener = useRef<HTMLElement | null>(null)
    const owner = session.status === "member" ? `${session.network.chainId}:${session.address}` : null
    const ownerRef = useRef<string | null>(owner)
    useLayoutEffect(() => {
        ownerRef.current = owner
        // An old request may still be waiting for RPC or wallet callbacks after
        // this provider unmounts. It must never open Adena for the next account.
        return () => { ownerRef.current = null }
    }, [owner])
    const holdReload = review !== null || pending.length > 0
    const reviewOpen = review !== null

    useLayoutEffect(() => {
        if (!reviewOpen) return
        const opener = reviewOpener.current
        const surfaces = [...document.querySelectorAll<HTMLElement>(".memba-os .os-menubar, .memba-os .os-desk, .memba-os .os-dock, .memba-os .os-phone, .memba-os .os-banner")]
        const previous = surfaces.map((el) => ({ el, inert: el.hasAttribute("inert"), hidden: el.getAttribute("aria-hidden") }))
        for (const el of surfaces) { el.setAttribute("inert", ""); el.setAttribute("aria-hidden", "true") }
        return () => {
            for (const { el, inert, hidden } of previous) {
                if (!inert) el.removeAttribute("inert")
                if (hidden === null) el.removeAttribute("aria-hidden")
                else el.setAttribute("aria-hidden", hidden)
            }
            requestAnimationFrame(() => { if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true }) })
        }
    }, [reviewOpen])

    // The global update notice lives above this provider. Hold its reload action
    // from the first review paint through preflight, Adena, and tray verification.
    useLayoutEffect(() => {
        if (holdReload) return beginWalletActivity()
    }, [holdReload])

    const notify = useCallback((n: Omit<TxNotice, "id">) => {
        setNotices((list) => [{ ...n, id: ++seq }, ...list].slice(0, 30))
        setUnread((u) => u + 1)
    }, [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- requests carry their own choice type
    const sign = useCallback((req: SignRequest<any>) => {
        if (session.status !== "member") { session.openConnect(); return }
        if (ownerRef.current !== owner) return
        if (busy.current) { toast("Finish the signature that's open first."); return }
        reviewOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setReview({ req, choice: req.choice?.initial, acked: (req.acks ?? []).map(() => false), stage: "review", error: null })
    }, [session, toast, owner])

    const settle = useCallback((req: SignRequest<string>, choice: string | undefined, outcome: SettledOutcome) => {
        setVersion((v) => v + 1)
        req.onSettled?.(outcome, choice)
    }, [])

    const go = useCallback(async () => {
        if (!review || busy.current) return
        // The button is disabled in these cases; the sheet enforces them here too.
        if (session.status !== "member") return
        const requestOwner = ownerRef.current
        if (!requestOwner || requestOwner !== owner) return
        if (!review.acked.every(Boolean)) return
        if (session.walletChainId && session.walletChainId !== session.network.chainId) return
        const { req, choice } = review
        let msgs
        try { msgs = req.prepare(choice).msgs } catch (err) {
            setReview((r) => r && { ...r, error: err instanceof Error ? err.message : String(err) })
            return
        }
        busy.current = true
        setReview((r) => r && { ...r, stage: "checking", error: null })
        const label = req.label(choice)
        const sameOwner = () => ownerRef.current === requestOwner
        const res = await executeSignature(req, choice, msgs, () => {
            if (sameOwner()) setReview((r) => r && { ...r, stage: "wallet" })
        }, sameOwner)
        busy.current = false
        if (!sameOwner()) return
        if (res.outcome === "failed" || res.outcome === "cancelled") {
            if (res.outcome === "cancelled") { setReview(null); toast(res.error); settle(req, choice, "cancelled"); return }
            setReview((r) => r && { ...r, stage: "review", error: res.error })
            return
        }
        if (res.outcome === "unknown") {
            setReview(null)
            notify({ kind: "warn", title: `Outcome unknown · ${label}`, sub: "Check before trying again." })
            toast(`Outcome unknown: ${label}. Check before retrying.`)
            settle(req, choice, "unknown")
            return
        }
        if (res.outcome !== "sent") { setReview(null); return }
        const hash = res.hash
        const id = ++seq
        setPending((p) => [...p, { id, label }])
        setReview(null)
        // Without a way to read the result back (older DAOs), "sent" is all we can say.
        const ok = req.verify ? await verifyWithRetries(() => req.verify!(choice, hash, res.result), req.verifyAttempts) : null
        if (!sameOwner()) return
        setPending((p) => p.filter((x) => x.id !== id))
        const where = `${session.network.chainId} · ${hash.slice(0, 10)}…`
        notify(ok === true
            ? { kind: "ok", title: `Confirmed · ${label}`, sub: where }
            : ok === null
                ? { kind: "ok", title: `Sent · ${label}`, sub: where }
                : { kind: "warn", title: `Submitted · ${label}`, sub: "The chain hasn't shown it yet. Don't send it again." })
        if (ok === false) toast(`Submitted: ${label}. Not visible on chain yet.`)
        settle(req, choice, ok === true ? "confirmed" : "submitted")
    }, [review, notify, toast, settle, session.network.chainId, session.walletChainId, session.status, owner])

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
    const dialog = useRef<HTMLDivElement>(null)
    const { req, choice, stage, error } = review
    const chain = session.network.chainId
    const wrongNet = !!session.walletChainId && session.walletChainId !== chain
    let checklist: SignRow[] = []
    let prepareError: string | null = null
    try { checklist = adenaChecklist(req.prepare(choice).msgs, chain) } catch (err) { prepareError = err instanceof Error ? err.message : String(err) }
    const allAcked = review.acked.every(Boolean)
    const canGo = stage === "review" && session.status === "member" && !wrongNet && !prepareError && allAcked

    useLayoutEffect(() => {
        const el = dialog.current
        if (!el) return
        el.focus({ preventScroll: true })
    }, [stage])

    return (
        <div className="os-scrim os-scrim-center">
            <div ref={dialog} className="os-review os-glass" role="dialog" aria-modal="true" aria-label={`Review · ${req.title}`} tabIndex={-1}
                onKeyDown={(e) => {
                    if (e.key === "Escape") { e.preventDefault(); onCancel() }
                    if (e.key !== "Tab") return
                    const stops = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') ?? [])]
                    if (!stops.length) { e.preventDefault(); dialog.current?.focus(); return }
                    const first = stops[0]
                    const last = stops[stops.length - 1]
                    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus() }
                    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
                }}>
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
                            {session.status !== "member" && <p className="os-note os-err" role="alert">Your Memba session ended. Cancel this review, then connect again before signing.</p>}
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
