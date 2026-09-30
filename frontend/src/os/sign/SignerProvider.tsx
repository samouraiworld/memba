/**
 * The signing layer's UI: the review sheet (D15), the "Adena should show"
 * checklist, the wrong-network block, and the transaction tray (pending count
 * in the menu bar, results in the notifications panel; browser-only, D28).
 *
 * @module os/sign/SignerProvider
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { clearGovernanceReceipt } from "../../lib/dao/governanceRecovery"
import { beginWalletActivity } from "../../lib/walletActivity"
import { useDialogKeys } from "../shell/useDialogKeys"
import type { OsSession } from "../shell/useOsSession"
import { accountMark, accountMarkAfterBlocks } from "./accountMark"
import { adenaChecklist, type SignRow } from "./decode"
import { executeSignature, verifyWithRetries, type SettledOutcome, type SignRequest } from "./signer"
import { SignerContext, type SignerApi, type TxNotice } from "./signerContext"

type Stage = "review" | "checking" | "wallet" | "settling"

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
    // Set when a review opens and cleared when it closes, in the same tick: state is a render behind.
    const shown = useRef(false)
    const closeReview = useCallback(() => { shown.current = false; setReview(null) }, [])
    const reviewOpener = useRef<HTMLElement | null>(null)
    const owner = session.status === "member" ? `${session.network.chainId}:${session.address}` : null
    const ownerRef = useRef<string | null>(owner)
    useLayoutEffect(() => {
        ownerRef.current = owner
        // An old request may still be waiting for RPC or wallet callbacks after
        // this provider unmounts. It must never open Adena for the next account.
        return () => { ownerRef.current = null }
    }, [owner])
    // Stops the account check of a "rejected" reply when this provider goes away.
    const gone = useRef<AbortController | null>(null)
    useEffect(() => {
        const controller = new AbortController()
        gone.current = controller
        return () => controller.abort()
    }, [])
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
        if (session.status !== "member") { session.openConnect(); return false }
        if (ownerRef.current !== owner) return false
        // A review on screen is never replaced: the member is reading it, and a second request
        // (another window, or a quote that returned late) would change the sheet under them.
        if (shown.current) { toast("A signature review is already open. Finish or cancel it first."); return false }
        shown.current = true
        reviewOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setReview({ req, choice: req.choice?.initial, acked: (req.acks ?? []).map(() => false), stage: "review", error: null })
        return true
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
        const signerAddress = session.address
        const sameOwner = () => ownerRef.current === requestOwner
        const res = await executeSignature(req, choice, msgs, () => {
            if (sameOwner()) setReview((r) => r && { ...r, stage: "wallet" })
        }, sameOwner, {
            before: () => accountMark(signerAddress),
            after: () => accountMarkAfterBlocks(signerAddress, gone.current?.signal),
            onSettling: () => { if (sameOwner()) setReview((r) => r && { ...r, stage: "settling" }) },
        })
        busy.current = false
        if (!sameOwner()) return
        if (res.outcome === "failed" || res.outcome === "cancelled") {
            if (res.outcome === "cancelled") { closeReview(); toast(res.error); settle(req, choice, "cancelled"); return }
            setReview((r) => r && { ...r, stage: "review", error: res.error })
            return
        }
        if (res.outcome === "refused") {
            // The same request would be refused again: close the review and keep the reason in the tray.
            closeReview()
            notify({ kind: "fail", title: `Refused by the network · ${label}`, sub: res.error })
            toast(`Refused by the network: ${label}. The reason is in the notifications.`)
            settle(req, choice, "failed")
            return
        }
        if (res.outcome === "unknown") {
            closeReview()
            notify({ kind: "warn", title: `Outcome unknown · ${label}`, sub: res.error || "Check before trying again." })
            toast(`Outcome unknown: ${label}. Check before retrying.`)
            settle(req, choice, "unknown")
            return
        }
        if (res.outcome !== "sent") { closeReview(); return }
        const hash = res.hash
        const id = ++seq
        setPending((p) => [...p, { id, label }])
        closeReview()
        // A wallet return alone is submission, not chain confirmation.
        const ok = req.verify ? await verifyWithRetries(() => req.verify!(choice, hash, res.result), req.verifyAttempts) : null
        if (!sameOwner()) return
        setPending((p) => p.filter((x) => x.id !== id))
        // Votes can release their lock after verification. A proposal's
        // confirmed ID must survive reload until the member starts another.
        if (ok === true && req.receipt && !req.retainConfirmedReceipt) {
            try { clearGovernanceReceipt(req.receipt) } catch { /* retain the conservative lock if storage refuses */ }
        }
        const where = `${session.network.chainId} · ${hash.slice(0, 10)}…`
        notify(ok === true
            ? { kind: "ok", title: `Confirmed · ${label}`, sub: where }
            : ok === "failed"
                ? { kind: "fail", title: `Refused by the network · ${label}`, sub: `${where}: the chain ran it and refused it. It did not take effect; the network fee was still charged.` }
                : ok === null
                    ? { kind: "ok", title: `Submitted · ${label}`, sub: where }
                    : { kind: "warn", title: `Submitted · ${label}`, sub: "The chain hasn't shown it yet. Don't send it again." })
        if (ok === false) toast(`Submitted: ${label}. Not visible on chain yet.`)
        if (ok === "failed") toast(`Refused by the network: ${label}. It did not take effect; the network fee was still charged.`)
        settle(req, choice, ok === true ? "confirmed" : ok === "failed" ? "failed" : "submitted")
    }, [review, notify, toast, settle, session.network.chainId, session.walletChainId, session.status, session.address, owner, closeReview])

    const cancel = useCallback(() => {
        if (review && review.stage !== "review") return // the wallet request is in flight, or its outcome is being checked
        closeReview()
    }, [review, closeReview])

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
    const lines = req.lines(choice)
    const allAcked = review.acked.every(Boolean)
    const canGo = stage === "review" && session.status === "member" && !wrongNet && !prepareError && allAcked

    useLayoutEffect(() => {
        const el = dialog.current
        if (!el) return
        el.focus({ preventScroll: true })
    }, [stage])

    // The radios that are not the chosen one are reached with the arrow keys, not Tab.
    useDialogKeys(dialog, true, 'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), summary, [tabindex="0"]', onCancel)

    return (
        <div className="os-scrim os-scrim-center">
            <div ref={dialog} className="os-review os-glass" role="dialog" aria-modal="true" aria-label={`Review · ${req.title}`} tabIndex={-1}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel() } }}>
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
                                        <button key={o} type="button" role="radio" aria-checked={choice === o} tabIndex={choice === o ? 0 : -1}
                                            onKeyDown={(event) => {
                                                const options = req.choice!.options
                                                const index = options.indexOf(o)
                                                const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                                                    : event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % options.length
                                                        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + options.length - 1) % options.length : -1
                                                if (next < 0) return
                                                event.preventDefault()
                                                onChoice(options[next])
                                                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
                                            }} onClick={() => onChoice(o)}>{o}</button>
                                    ))}
                                </div>
                            )}
                            <Rows rows={lines.map(([label, value]) => ({ label, value }))} />
                            {lines.some(([label]) => label === "Network fee") && (
                                <p className="os-sub os-flush">Adena shows the fee it signs. It can differ from the figure above.</p>
                            )}
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
                        <div className="os-rvh" role="status">
                            <div className="os-row"><span className="os-spin" aria-hidden="true" /><h2 className="os-rv-title">{stage === "checking" ? "Checking before you sign…" : stage === "settling" ? "Checking your account…" : "Confirm in Adena"}</h2></div>
                            <div className="os-sub">{stage === "checking" ? "Memba re-reads the chain so what you sign still applies."
                                : stage === "settling" ? "Adena reported a cancellation. It says the same when its window is closed after you confirm, so Memba waits three blocks and compares your account first. This can take half a minute."
                                    : "Adena opened in its own window. Check it shows:"}</div>
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
