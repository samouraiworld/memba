import { useEffect, useRef, useState } from "react"
import { accept, cancel, getActive, offer, type Game } from "../../lib/connect4"
import { Empty, Gate, Loading, Pill, Toggle } from "../../os/kit"
import { COLS, ROWS, cell } from "./rules"
import { TxError } from "./TxError"
import { QuickPlay } from "./QuickPlay"
import { fmtSeconds, formatGnot, shortAddr, useActive, useChainNow, useTx } from "./useConnect4"
import "./connect4.css"

// The realm's default fee, used for the pre-sign estimate only; per-game results use g.fee.
const FEE_UGNOT = 100_000

export function Lobby({ me, connected, onOpen }: { me: string; connected: boolean; onOpen: (id: number) => void }) {
    const { data, dataUpdatedAt, isLoading } = useActive()
    const now = useChainNow(data?.now, dataUpdatedAt)
    const tx = useTx()
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const [stake, setStake] = useState("1")
    const [validFor, setValidFor] = useState("10")
    const [opponent, setOpponent] = useState("")
    const [mineOnly, setMineOnly] = useState(false)
    const games = (data?.games ?? []).filter((g) => !mineOnly || g.creator === me || g.acceptor === me || g.opponent === me)
    const offers = games.filter((g) => g.status === "open")
    const live = games.filter((g) => g.status === "playing")

    // A creator whose offer was accepted must reveal: open that game so the reveal prompt/auto-reveal runs.
    const opened = useRef(new Set<number>())
    useEffect(() => {
        if (!connected) return
        for (const g of data?.games ?? []) {
            if (g.status === "playing" && g.turn === 0 && g.creator === me && !opened.current.has(g.id)) {
                opened.current.add(g.id)
                onOpen(g.id)
            }
        }
    }, [data, connected, me, onOpen])

    const stakeUgnot = Math.round(Number(stake) * 1_000_000)
    const minutes = Number(validFor)
    const formOk = Number.isSafeInteger(stakeUgnot) && stakeUgnot >= 1_000_000 && stakeUgnot > FEE_UGNOT
        && Number.isInteger(minutes) && minutes >= 1 && minutes <= 60
        && (opponent === "" || /^g1[02-9ac-hj-np-z]{38}$/.test(opponent))

    const post = () => tx.run(async () => {
        const commitment = await offer(me, { stakeUgnot, validFor: minutes, opponent })
        // ponytail: finds the new game in the first 100 active games; page if the lobby ever grows past that.
        for (let i = 0; i < 10; i++) {
            if (!alive.current) return
            const found = (await getActive(0, 100))?.games.find((g) => g.creator === me && g.commitment === commitment)
            if (!alive.current) return
            if (found) { onOpen(found.id); return }
            await new Promise((r) => setTimeout(r, 1_500))
        }
        if (alive.current) throw new Error("Your offer was posted but hasn't appeared yet — it will show in the lobby shortly.")
    })

    const canAccept = (g: Game) => connected && g.creator !== me && (g.opponent === "" || g.opponent === me) && now < g.expiresAt
    const canCancel = (g: Game) => connected && (g.creator === me || now >= g.expiresAt)
    const who = (a: string) => (a === me ? "you" : shortAddr(a))

    return <div className="os-stack c4">
        <div className="c4-hero">
            <div className="c4-hero-discs" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
            <div className="os-grow">
                <h2>Connect 4</h2>
                <p>Both players stake the same GNOT; the winner takes the pot minus a {formatGnot(FEE_UGNOT)} fee. Each move has 90 seconds of chain time — run out and you forfeit.</p>
            </div>
            <div className="os-row c4-hero-controls">
                <QuickPlay me={me} connected={connected} />
                {connected && <span className="os-row"><span id="c4-mine" className="os-sub">Only my games</span><Toggle checked={mineOnly} onChange={setMineOnly} labelledBy="c4-mine" /></span>}
            </div>
        </div>
        <TxError message={tx.error} onDismiss={tx.clearError} />
        {!connected && <Gate text="Connect your wallet to play. You can watch games without one." />}

        <div className="c4-lobby">
            <div className="os-stack">
                {isLoading ? <Loading label="Loading games…" /> : <>
                    <section className="os-stack os-tight">
                        <h3>Open offers <span className="c4-count">{offers.length}</span></h3>
                        {offers.length === 0 ? <Empty title="No open offers. Post one and wait for a challenger." /> : <ul className="c4-cards">
                            {offers.map((g) => {
                                const expired = now >= g.expiresAt
                                const soon = !expired && g.expiresAt - now <= 60
                                return <li key={g.id} className="c4-offer" aria-label={`Game #${g.id}`} data-expired={expired}>
                                    <div className="os-row c4-offer-top">
                                        <span className="c4-mini-disc c4-red" aria-hidden="true" />
                                        <b>#{g.id}</b>
                                        {g.creator === me && <Pill tone="ok">yours</Pill>}
                                        {g.opponent && <Pill>{g.opponent === me ? "for you" : "private"}</Pill>}
                                        <span className={`c4-timer${expired ? " c4-timer-out" : soon ? " c4-timer-soon" : ""}`}>{expired ? "expired" : fmtSeconds(g.expiresAt - now)}</span>
                                    </div>
                                    <div className="c4-offer-stake">
                                        <strong>{formatGnot(g.stake)}</strong>
                                        <small>stake each · winner gets {formatGnot(2 * g.stake - g.fee)}</small>
                                    </div>
                                    <div className="os-sub">by {who(g.creator)}</div>
                                    <div className="os-row c4-offer-actions">
                                        {g.creator !== me && <button type="button" className="os-btn c4-cta" disabled={tx.pending || !canAccept(g)} onClick={() => tx.run(async () => { await accept(me, g); onOpen(g.id) })}>Accept</button>}
                                        {canCancel(g) && <button type="button" className="os-btn os-quiet" disabled={tx.pending} onClick={() => tx.run(() => cancel(me, g.id))}>Cancel</button>}
                                        <button type="button" className="os-btn os-quiet" aria-label={`Open game #${g.id}`} onClick={() => onOpen(g.id)}>Open</button>
                                    </div>
                                </li>
                            })}
                        </ul>}
                    </section>
                    <section className="os-stack os-tight">
                        <h3>Live games <span className="c4-count">{live.length}</span></h3>
                        {live.length === 0 ? <Empty title="No games in progress right now." /> : <ul className="c4-cards">
                            {live.map((g) => <li key={g.id} aria-label={`Game #${g.id}`}>
                                <button type="button" className="c4-live" aria-label={`Open game #${g.id}`} onClick={() => onOpen(g.id)}>
                                    <MiniBoard board={g.board} />
                                    <span className="c4-live-info">
                                        <b>#{g.id} {(g.creator === me || g.acceptor === me) && <Pill tone="ok">yours</Pill>}</b>
                                        <span className="os-sub">pot {formatGnot(2 * g.stake)} · {g.moves} moves</span>
                                        {g.turn === 0 ? <Pill tone="warn">awaiting reveal</Pill> : g.turnPlayer === me ? <Pill tone="ok">your move</Pill> : <span className="os-row c4-live-turn"><span className={`c4-mini-disc ${g.turn === 1 ? "c4-red" : "c4-yellow"}`} aria-hidden="true" />{shortAddr(g.turnPlayer)} to move</span>}
                                    </span>
                                </button>
                            </li>)}
                        </ul>}
                    </section>
                </>}
            </div>

            {connected && <aside className="c4-post">
                <form className="c4-form" onSubmit={(e) => { e.preventDefault(); if (formOk) void post() }}>
                    <h3>Post an offer</h3>
                    <div className="c4-field">
                        <label htmlFor="c4-stake">Stake (GNOT)</label>
                        <input id="c4-stake" type="number" min="1" step="0.1" value={stake} onChange={(e) => setStake(e.target.value)} />
                        <QuickPicks label="Stake presets" values={["1", "2", "5", "10"]} unit="GNOT" value={stake} onPick={setStake} />
                    </div>
                    <div className="c4-field">
                        <label htmlFor="c4-valid">Valid for (minutes)</label>
                        <input id="c4-valid" type="number" min="1" max="60" value={validFor} onChange={(e) => setValidFor(e.target.value)} />
                        <QuickPicks label="Duration presets" values={["5", "10", "30", "60"]} unit="min" value={validFor} onPick={setValidFor} />
                    </div>
                    <div className="c4-field">
                        <label htmlFor="c4-opp">Opponent address (optional)</label>
                        <input id="c4-opp" value={opponent} onChange={(e) => setOpponent(e.target.value.trim())} placeholder="g1… — leave empty for anyone" />
                    </div>
                    <div className="c4-payout" aria-live="polite">
                        <span><small>You stake</small><b>{formOk ? formatGnot(stakeUgnot) : "—"}</b></span>
                        <span className="c4-payout-arrow" aria-hidden="true">→</span>
                        <span><small>Winner gets</small><b>{formOk ? formatGnot(2 * stakeUgnot - FEE_UGNOT) : "—"}</b></span>
                    </div>
                    <div className="os-note os-warn">After someone accepts, you must reveal within 90 seconds — keep this tab open until the game starts. The reveal key is stored only in this browser; missing it forfeits your stake.</div>
                    <button type="submit" className="os-btn c4-cta c4-cta-wide" disabled={!formOk || tx.pending}>Post offer</button>
                </form>
            </aside>}
        </div>
    </div>
}

function QuickPicks({ label, values, unit, value, onPick }: { label: string; values: string[]; unit: string; value: string; onPick: (v: string) => void }) {
    return <div className="c4-quick" role="group" aria-label={label}>
        {values.map((v) => <button key={v} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>{v} {unit}</button>)}
    </div>
}

/** A thumbnail of a game's board: 7 columns × 6 rows, top row first. */
function MiniBoard({ board }: { board: string }) {
    return <span className="c4-miniboard" aria-hidden="true">
        {Array.from({ length: ROWS }, (_, i) => Array.from({ length: COLS }, (_, c) => {
            const p = cell(board, c, ROWS - 1 - i)
            return <i key={`${c}-${i}`} className={p === "1" ? "c4-red" : p === "2" ? "c4-yellow" : undefined} />
        }))}
    </span>
}
