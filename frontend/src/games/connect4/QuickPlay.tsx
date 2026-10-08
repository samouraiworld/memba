import { useEffect, useId, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUICKPLAY_DURATIONS, QUICKPLAY_LABEL as LABEL, endQuickPlay, forgetQuickPlay, quickPlayDuration, quickPlayStatus, setQuickPlayDuration, setSignEachMove, signEachMove, startQuickPlay, type QuickPlayDuration } from "../../lib/quickPlay"
import { ACTIVE_NETWORK_KEY, connect4PathFor } from "../../lib/config"
import { TxError } from "./TxError"
import { useWalletBroadcast } from "./osWallet"

const MOVE_FEE_UGNOT = 30_000
// Under ~10 moves of gas left: offer a fresh session (the chain can't top one up).
const LOW_UGNOT = 10 * MOVE_FEE_UGNOT

export function QuickPlay({ me, connected }: { me: string; connected: boolean }) {
    const client = useQueryClient()
    const broadcast = useWalletBroadcast()
    const { data: status, isError } = useQuery({ queryKey: ["quickplay", me], queryFn: () => quickPlayStatus(me), enabled: connected && !!me,
        // A just-sent session is polled quickly until the chain shows it.
        refetchInterval: (q) => (q.state.data === "pending" ? 3_000 : 30_000) })
    // Wall-clock seconds in state (ticks each second): Date.now() in render is impure.
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
    useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000); return () => clearInterval(t) }, [])
    const [open, setOpen] = useState(false)
    const [duration, setDuration] = useState<QuickPlayDuration>(quickPlayDuration)
    const [signEach, setSignEach] = useState(signEachMove)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const root = useRef<HTMLDivElement>(null)
    const toggle = useRef<HTMLButtonElement>(null)
    const panelId = useId()
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggle.current?.focus() } }
        const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) { setOpen(false); toggle.current?.focus() } }
        document.addEventListener("keydown", onKey); document.addEventListener("pointerdown", onDown)
        return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown) }
    }, [open])
    if (!connected || !me || !connect4PathFor(ACTIVE_NETWORK_KEY)) return null

    const act = async (fn: () => Promise<unknown>) => {
        setBusy(true); setError(null)
        try { await fn(); setOpen(false) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false); await client.invalidateQueries({ queryKey: ["quickplay", me] }) }
    }

    const onSignEach = (on: boolean) => { setSignEachMove(on); setSignEach(on); void client.invalidateQueries({ queryKey: ["quickplay", me] }) }
    // Closed by default: Quick play is the default, signing every transaction is the opt-out.
    const advanced = <>
        <button type="button" ref={toggle} className="os-btn os-quiet c4-qp-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>Advanced</button>
        {open && <div className="c4-qp-panel" id={panelId}>
            <label className="c4-qp-check"><input type="checkbox" checked={signEach} onChange={(e) => onSignEach(e.target.checked)} /> <span>Sign every transaction in my wallet<small className="os-sub">Pauses Quick play. A running session stays live until it ends — use End session to revoke it.</small></span></label>
            {/* Disabled, not removed, while signing each move: the popover keeps its size. */}
            <fieldset className="c4-qp-opts" disabled={signEach}>
                <div className="c4-quick" role="group" aria-label="Quick play duration">
                    {QUICKPLAY_DURATIONS.map((d) => <button key={d} type="button" aria-pressed={d === duration} onClick={() => { setDuration(d); setQuickPlayDuration(d) }}>{LABEL[d]}</button>)}
                </div>
                <p className="os-sub">Offer and Accept start it in the same approval. Until it ends, its key signs moves in all your live games without a popup. Staking and resigning still ask your wallet. Up to 5 GNOT/day of gas, less if your balance after the stake is lower.</p>
            </fieldset>
        </div>}
    </>

    const readError = isError && <span className="os-note os-warn" role="status">Couldn't read Quick play status</span>
    if (status || isError) {
        let low = false
        const pill = status === "pending"
            ? <span className="c4-qp-pill" data-tone="pending">⚡ Quick play · confirming…</span>
            : status && (() => {
            const left = Math.max(0, Math.floor(status.expiresAt - now))
            const raw = status.spendLimitUgnot - status.spendUsedUgnot
            const remaining = Number.isFinite(raw) ? Math.max(0, raw) : 0
            const spent = remaining < MOVE_FEE_UGNOT
            low = remaining < LOW_UGNOT
            return <span className="c4-qp-pill" data-tone={signEach ? "paused" : spent ? "warn" : undefined} title={signEach ? "Paused: your wallet signs every move." : undefined}>{spent
                ? "⚡ Quick play · budget used up for today"
                : `⚡ Quick play · ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m left · ${(remaining / 1_000_000).toFixed(2)} GNOT budget`}</span>
        })()
        // With the RPC down and no stale data the key can still be dropped here.
        return <div className="c4-qp" data-on="true" ref={root}>
            {pill}
            {low && !signEach && <button type="button" className="os-btn" disabled={busy} title="Replaces this session with a new one and a full budget." onClick={() => act(() => startQuickPlay(me, duration, broadcast, true))}>Renew · 1 approval</button>}
            <button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => act(() => endQuickPlay(me, broadcast))}>End session</button>
            <button type="button" className="os-btn os-quiet c4-qp-forget" title="Deletes the key here; doesn't revoke on chain — the session runs until it expires." disabled={busy} onClick={() => { forgetQuickPlay(me); void client.invalidateQueries({ queryKey: ["quickplay", me] }) }}>Forget on this device</button>
            {advanced}
            {readError}
            <TxError message={error} onDismiss={() => setError(null)} />
        </div>
    }

    // Start and the opt-out note share one cell sized to the wider, so ticking doesn't move the banner.
    return <div className="c4-qp" ref={root}>
        <span className="c4-qp-slot">
            <button type="button" className="os-btn c4-cta" data-off={signEach || undefined} disabled={busy || signEach} title="Moves sign automatically for the session; stakes still ask your wallet."
                onClick={() => act(() => startQuickPlay(me, duration, broadcast))}>⚡ Start Quick play · {LABEL[duration]} · 1 approval</button>
            <span className="c4-qp-note" data-off={!signEach || undefined}>Wallet signs every move</span>
        </span>
        {advanced}
        {/* Outside the panel: confirming in the wallet dialog closes it before Start settles. */}
        <TxError message={error} onDismiss={() => setError(null)} />
    </div>
}
