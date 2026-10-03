import { useEffect, useId, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUICKPLAY_DURATIONS, endQuickPlay, forgetQuickPlay, quickPlayStatus, startQuickPlay, type QuickPlayDuration } from "../../lib/quickPlay"
import { ACTIVE_NETWORK_KEY, connect4PathFor } from "../../lib/config"
import { TxError } from "./TxError"

const MOVE_FEE_UGNOT = 30_000
const LABEL: Record<QuickPlayDuration, string> = { 3600: "1h", 14400: "4h", 86400: "24h" }

export function QuickPlay({ me, connected }: { me: string; connected: boolean }) {
    const client = useQueryClient()
    const { data: status, isError } = useQuery({ queryKey: ["quickplay", me], queryFn: () => quickPlayStatus(me), enabled: connected && !!me, refetchInterval: 30_000 })
    // Wall-clock seconds in state (ticks each second): Date.now() in render is impure.
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
    useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000); return () => clearInterval(t) }, [])
    const [open, setOpen] = useState(false)
    const [duration, setDuration] = useState<QuickPlayDuration>(14400)
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

    const readError = isError && <span className="os-note os-warn" role="status">Couldn't read Quick play status</span>
    if (status || isError) {
        const pill = status && (() => {
            const left = Math.max(0, Math.floor(status.expiresAt - now))
            const raw = status.spendLimitUgnot - status.spendUsedUgnot
            const remaining = Number.isFinite(raw) ? Math.max(0, raw) : 0
            const spent = remaining < MOVE_FEE_UGNOT
            return <span className="c4-qp-pill" data-tone={spent ? "warn" : undefined}>{spent
                ? "⚡ Quick play · budget used up for today"
                : `⚡ Quick play · ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m left · ${(remaining / 1_000_000).toFixed(2)} GNOT budget`}</span>
        })()
        // With the RPC down and no stale data the key can still be dropped here.
        return <div className="c4-qp" data-on="true">
            {pill}
            <button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => act(() => endQuickPlay(me))}>End session</button>
            <button type="button" className="os-btn os-quiet c4-qp-forget" title="Deletes the key here; doesn't revoke on chain — the session runs until it expires." disabled={busy} onClick={() => { forgetQuickPlay(me); void client.invalidateQueries({ queryKey: ["quickplay", me] }) }}>Forget on this device</button>
            {readError}
            <TxError message={error} onDismiss={() => setError(null)} />
        </div>
    }

    return <div className="c4-qp" ref={root}>
        <button type="button" ref={toggle} className="os-btn c4-qp-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>⚡ Quick play</button>
        {open && <div className="c4-qp-panel" id={panelId}>
            <div className="c4-quick" role="group" aria-label="Quick play duration">
                {QUICKPLAY_DURATIONS.map((d) => <button key={d} type="button" aria-pressed={d === duration} onClick={() => setDuration(d)}>{LABEL[d]}</button>)}
            </div>
            <p className="os-sub">Moves sign automatically. Stakes still ask your wallet. Up to 1 GNOT/day of gas.</p>
            <button type="button" className="os-btn c4-cta" disabled={busy} onClick={() => act(() => startQuickPlay(me, duration))}>Start · 1 wallet approval</button>
            <TxError message={error} onDismiss={() => setError(null)} />
        </div>}
    </div>
}
