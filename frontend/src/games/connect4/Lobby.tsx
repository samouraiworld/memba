import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { accept, cancel, getActive, offer, type Game } from "../../lib/connect4"
import { QUICKPLAY_LABEL, hasLocalSession, quickPlayBudget, quickPlayDuration, quickPlayStatus, signEachMove } from "../../lib/quickPlay"
import { useBalance } from "../../hooks/useBalance"
import { Empty, Gate, Loading, Pill, Toggle } from "../../os/kit"
import { COLS, ROWS, cell } from "./rules"
import { TxError } from "./TxError"
import { QuickPlay } from "./QuickPlay"
import { Leaders } from "./Leaders"
import { useWalletBroadcast } from "./osWallet"
import { fmtSeconds, formatGnot, shortAddr, useActive, useChainNow, useTx } from "./useConnect4"
import "./connect4.css"

// Reveal steps already auto-opened ("id:revealed"): module-level so "← Lobby" (a remount) doesn't send the player straight back.
const autoOpened = new Set<string>()
// Below about one move's gas a session is useless; withQuickPlay sends the stake alone.
const MIN_QP_BUDGET = 30_000

export function Lobby({ me, connected, onOpen }: { me: string; connected: boolean; onOpen: (id: number) => void }) {
    const { data, dataUpdatedAt, isLoading } = useActive()
    const now = useChainNow(data?.now, dataUpdatedAt)
    // The fee a new offer pays, from the realm. It is sent as the offer's maximum, so a fee raised before the offer lands is refused.
    const fee = data?.fee ?? null
    const tx = useTx()
    const broadcast = useWalletBroadcast()
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const [stake, setStake] = useState("1")
    const [validFor, setValidFor] = useState("10")
    const [opponent, setOpponent] = useState("")
    const [mineOnly, setMineOnly] = useState(false)
    // Consent, shown at the stake, to start Quick play in the same approval (lib/quickPlay withQuickPlay).
    const [withQp, setWithQp] = useState(true)
    const { rawUgnot } = useBalance(connected ? me : null)
    // Re-read on the QuickPlay panel's query (start, end, opt-out), not on every tick.
    useQuery({ queryKey: ["quickplay", me], queryFn: () => quickPlayStatus(me), enabled: false })
    const bundles = connected && !!me && !signEachMove() && !hasLocalSession(me)
    const consent = (stakeUgnot: number) => {
        if (!bundles) return null
        const budget = rawUgnot === undefined ? null : quickPlayBudget(rawUgnot, stakeUgnot)
        if (budget !== null && budget < MIN_QP_BUDGET) return <p className="os-sub">Not enough GNOT left after the stake for Quick play — your wallet will sign each move.</p>
        return <label className="c4-qp-consent"><input type="checkbox" checked={withQp} onChange={(e) => setWithQp(e.target.checked)} />
            <span>+ Quick play {QUICKPLAY_LABEL[quickPlayDuration()]}, up to {budget === null ? "5 GNOT" : formatGnot(budget)}/day of gas — moves in your live games sign without a popup</span></label>
    }
    const games = (data?.games ?? []).filter((g) => !mineOnly || g.creator === me || g.acceptor === me || g.opponent === me)
    const offers = games.filter((g) => g.status === "open")
    const live = games.filter((g) => g.status === "playing")

    // A player who must reveal (the creator first, then the acceptor's seed): open that game once per step, while its clock runs.
    useEffect(() => {
        if (!connected || !data) return
        for (const g of data.games) {
            const step = `${g.id}:${g.revealed}`
            if (g.status === "playing" && g.turn === 0 && (g.revealed ? g.acceptor === me : g.creator === me) && g.deadline > data.now && !autoOpened.has(step)) {
                autoOpened.add(step)
                onOpen(g.id)
            }
        }
    }, [data, connected, me, onOpen])

    const stakeUgnot = Math.round(Number(stake) * 1_000_000)
    const minutes = Number(validFor)
    const formOk = fee !== null && Number.isSafeInteger(stakeUgnot) && stakeUgnot >= 1_000_000 && stakeUgnot > fee
        && Number.isInteger(minutes) && minutes >= 1 && minutes <= 60
        && (opponent === "" || /^g1[02-9ac-hj-np-z]{38}$/.test(opponent))

    const post = (maxFeeUgnot: number) => tx.run(async () => {
        const commitment = await offer(me, { stakeUgnot, validFor: minutes, opponent, maxFeeUgnot }, broadcast, withQp)
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
                <p>Both players stake the same GNOT; the winner takes the pot minus {fee === null ? "a house fee" : `a ${formatGnot(fee)} fee`}. Each move has 90 seconds of chain time — run out and you forfeit.</p>
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
                                        {g.creator !== me && <button type="button" className="os-btn c4-cta" disabled={tx.pending || !canAccept(g)} onClick={() => tx.run(async () => { await accept(me, g, broadcast, withQp); onOpen(g.id) })}>Accept</button>}
                                        {canCancel(g) && <button type="button" className="os-btn os-quiet" disabled={tx.pending} onClick={() => tx.run(() => cancel(me, g.id, broadcast))}>Cancel</button>}
                                        <button type="button" className="os-btn os-quiet" aria-label={`Open game #${g.id}`} onClick={() => onOpen(g.id)}>Open</button>
                                    </div>
                                    {canAccept(g) && consent(g.stake)}
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
                                        {g.turn === 0 ? <Pill tone="warn">{g.revealed ? "awaiting seed" : "awaiting reveal"}</Pill> : g.turnPlayer === me ? <Pill tone="ok">your move</Pill> : <span className="os-row c4-live-turn"><span className={`c4-mini-disc ${g.turn === 1 ? "c4-red" : "c4-yellow"}`} aria-hidden="true" />{shortAddr(g.turnPlayer)} to move</span>}
                                    </span>
                                </button>
                            </li>)}
                        </ul>}
                    </section>
                </>}
            </div>

            <div className="c4-aside">
                {connected && <aside className="c4-post">
                    <form className="c4-form" onSubmit={(e) => { e.preventDefault(); if (formOk && fee !== null) void post(fee) }}>
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
                            <span><small>Winner gets</small><b>{formOk && fee !== null ? formatGnot(2 * stakeUgnot - fee) : "—"}</b></span>
                        </div>
                        <div className="os-note os-warn">After someone accepts, you must reveal within 90 seconds — keep this tab open until the game starts. The reveal key is stored only in this browser; missing it forfeits your stake.</div>
                        {formOk && consent(stakeUgnot)}
                        <button type="submit" className="os-btn c4-cta c4-cta-wide" disabled={!formOk || tx.pending}>Post offer</button>
                    </form>
                </aside>}
                <Leaders me={connected ? me : ""} />
            </div>
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
