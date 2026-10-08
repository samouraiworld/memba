import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { QUICKPLAY_FALLBACK_EVENT, cancel, claimTimeout, getGame, play, resign, reveal, revealKey, revealSeed, type Game } from "../../lib/connect4"
import { quickPlayOn, quickPlayStatus } from "../../lib/quickPlay"
import { Empty, Loading, Pill, type PillTone } from "../../os/kit"
import { Board } from "./Board"
import { TxError } from "./TxError"
import { QuickPlay } from "./QuickPlay"
import { useWalletBroadcast } from "./osWallet"
import { fmtSeconds, formatGnot, shortAddr, useChainNow, useGame, useTx } from "./useConnect4"
import "./connect4.css"

type Snap = Pick<Game, "moves" | "turn" | "revealed"> | null
const sameTurn = (g: Game, s: Snap) => !!s && g.moves === s.moves && g.turn === s.turn && g.revealed === s.revealed
// When a move's outcome is unknown, the wallet may re-send it only while this still holds on a fresh read.
type Applies = (g: Game, sent: Snap) => boolean

const STATUS_TONE: Record<Game["status"], PillTone> = { open: "neutral", playing: "ok", won: "neutral", draw: "neutral", void: "neutral", cancelled: "neutral" }

function result(g: Game, me: string): string {
    const pot = 2 * g.stake - g.fee
    if (g.status === "won") return g.winner === me ? `You won ${formatGnot(pot)}.` : `${g.winner === g.creator ? "Creator" : "Acceptor"} won ${formatGnot(pot)}.`
    if (g.status === "draw") return `Draw — each player got ${formatGnot(g.stake)} back.`
    if (g.status === "void") return "Void — no one moved in time; both stakes were refunded."
    return "Offer cancelled; the stake was refunded."
}

export function GameView({ id, me, connected, onBack }: { id: number; me: string; connected: boolean; onBack: () => void }) {
    const { data, dataUpdatedAt, isLoading, isError } = useGame(id)
    const now = useChainNow(data?.now, dataUpdatedAt)
    const tx = useTx()
    const broadcast = useWalletBroadcast()
    // Moves try Quick play first; `wallet` re-sends a failed one through the wallet, re-checked right before Adena opens.
    const plain = { broadcast }, wallet = { viaWallet: true, broadcast, beforeSign: () => stillApplies() }
    const g = data?.game ?? null
    const isCreator = connected && g?.creator === me
    const isAcceptor = connected && g?.acceptor === me
    const isPlayer = isCreator || isAcceptor
    const needsReveal = g?.status === "playing" && g.turn === 0
    const left = g ? g.deadline - now : 0
    const expired = g?.status === "playing" && left <= 0
    // Two reveals before the first move: the creator's passphrase, then the acceptor's seed.
    const myReveal = !!g && needsReveal && (g.revealed ? isAcceptor : isCreator)
    const key = myReveal && !expired && g ? revealKey(me, g.revealed ? g.seedCommitment : g.commitment) : null
    const autoRevealed = useRef(false)
    // Time left is captured when a move fails: the immediate wallet route is decided then, once.
    const leftRef = useRef(left)
    useEffect(() => { leftRef.current = left })
    const failLeft = useRef(Infinity)
    // Read localStorage once per account/session change, not per 1s tick (observes the QuickPlay panel's query).
    const { dataUpdatedAt: qpUpdatedAt } = useQuery({ queryKey: ["quickplay", me], queryFn: () => quickPlayStatus(me), enabled: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- qpUpdatedAt is the invalidation signal
    const quick = useMemo(() => connected && quickPlayOn(me), [connected, me, qpUpdatedAt])
    const latest = useRef(g)
    useEffect(() => { latest.current = g })
    // The game as it was when the failed action was sent (captured before sending), and what must still hold to re-send it.
    const failed = useRef<{ sent: Snap; applies: Applies }>({ sent: null, applies: () => false })
    const [note, setNote] = useState<string | null>(null)
    useEffect(() => {
        let t: ReturnType<typeof setTimeout> | undefined
        const on = (e: Event) => { setNote(String((e as CustomEvent).detail)); clearTimeout(t); t = setTimeout(() => setNote(null), 6_000) }
        window.addEventListener(QUICKPLAY_FALLBACK_EVENT, on)
        return () => { window.removeEventListener(QUICKPLAY_FALLBACK_EVENT, on); clearTimeout(t) }
    }, [])
    // Quick play moves carry their wallet twin, so a failure can be re-sent via Adena.
    const run = (fn: () => Promise<unknown>, walletFn: () => Promise<unknown>, applies: Applies) => {
        const sent: Snap = latest.current && { moves: latest.current.moves, turn: latest.current.turn, revealed: latest.current.revealed }
        return tx.run(async () => {
            try { return await fn() } catch (e) { failLeft.current = leftRef.current; failed.current = { sent, applies }; throw e }
        }, quick ? walletFn : undefined)
    }
    const canPlay: Applies = (x, sent) => x.status === "playing" && sameTurn(x, sent) && x.turn !== 0 && x.turnPlayer === me
    const canReveal: Applies = (x, sent) => x.status === "playing" && sameTurn(x, sent) && x.turn === 0 && !x.revealed && x.creator === me
    const canRevealSeed: Applies = (x, sent) => x.status === "playing" && sameTurn(x, sent) && x.turn === 0 && x.revealed && x.acceptor === me
    // ClaimTimeout ends the game, so it still playing means it didn't land.
    const stillPlaying: Applies = (x) => x.status === "playing"
    // The review sheet and wallet can sit open a while: the action must still apply on a read taken just before signing.
    const stillApplies = async () => {
        const game = (await getGame(id).catch(() => null))?.game
        if (!game) throw new Error("Couldn't check the game before signing. Nothing was sent.")
        if (!failed.current.applies(game, failed.current.sent)) throw new Error("The game moved on before you signed. Nothing was sent.")
    }
    const doReveal = (k: string) => !g ? Promise.resolve(false)
        : g.revealed ? run(() => revealSeed(me, g.id, k, plain), () => revealSeed(me, g.id, k, wallet), canRevealSeed)
        : run(() => reveal(me, g.id, k, plain), () => reveal(me, g.id, k, wallet), canReveal)

    useEffect(() => {
        if (!key || !g || autoRevealed.current) return
        autoRevealed.current = true
        void doReveal(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, g, me, tx])

    const { error, errorName, retryWithWallet, clearError, failures } = tx
    const handled = useRef(0)
    const unknown = errorName === "OutcomeUnknownError"
    // After an unknown outcome the move may have landed: re-send via the wallet only on a fresh read that proves it didn't.
    const walletRoute = async () => {
        if (!retryWithWallet) return
        if (unknown) {
            const game = (await getGame(id).catch(() => null))?.game
            if (!game) { setNote("Couldn't check whether your move landed. Try again in a moment."); return }
            const { sent, applies } = failed.current
            if (!applies(game, sent)) { clearError(); setNote(sameTurn(game, sent) && game.status === "playing" ? "This move can't be made any more." : "Your move already landed."); return }
        }
        retryWithWallet()
    }
    useEffect(() => {
        if (!retryWithWallet || handled.current === failures) return
        handled.current = failures
        // A RealmError would only fail again; an unknown outcome is re-checked first (walletRoute).
        if (failLeft.current < 15 && errorName !== "RealmError") void walletRoute()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per failure; retryWithWallet changes identity every render
    }, [failures])

    // Outcome unknown with time to spare: watch the chain for 10s, then offer the wallet only
    // if it is still our turn and no move landed.
    const [watched, setWatched] = useState(false)
    useEffect(() => {
        if (!unknown) return
        const t = setTimeout(() => {
            // Without a game to check, offer the wallet: walletRoute re-reads before it signs.
            const cur = latest.current
            if (!cur || failed.current.applies(cur, failed.current.sent)) setWatched(true)
            else clearError()
        }, 10_000)
        return () => { clearTimeout(t); setWatched(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only per failure; clearError is a fresh closure each render
    }, [unknown, failures, me])
    const moves = g?.moves, turn = g?.turn
    useEffect(() => {
        if (unknown && failLeft.current >= 15 && g && !sameTurn(g, failed.current.sent)) clearError()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the move count and turn only
    }, [moves, turn])
    const txError = unknown && !watched ? "Outcome unknown — checking…"
        : unknown ? "Outcome unknown — your move may not have landed."
        : error
    const txAction = retryWithWallet && (!unknown || watched)
        ? { label: unknown ? "Sign this move with your wallet" : "Use wallet instead", onClick: () => void walletRoute() }
        : undefined

    const back = <button type="button" className="os-btn os-quiet" onClick={onBack}>← Lobby</button>
    if (isLoading) return <Loading label={`Loading game #${id}…`} />
    if (!g) {
        if (data?.game === null) return <Empty title={`Game #${id} not found.`} action={back} />
        return <div className="os-stack">{isError ? <div className="os-note os-warn" role="status">Couldn't reach the network. Retrying…</div> : <Loading label={`Loading game #${id}…`} />}<div>{back}</div></div>
    }

    const myTurn = connected && g.status === "playing" && g.turnPlayer === me && !expired
    const won = g.status === "won" && g.winner === me
    const lost = g.status === "won" && isPlayer && g.winner !== me
    const piece = !connected ? undefined : g.creator === me ? "1" : g.acceptor === me ? "2" : undefined
    const live = g.status === "playing" && g.turn !== 0
    const turnText = myTurn ? "Your move!" : isPlayer ? "Opponent's move" : `${shortAddr(g.turnPlayer)}'s move`

    return <div className="os-stack c4">
        <div className="os-row c4-head">
            {back}
            <h2 className="os-grow">Game #{id}</h2>
            <Pill tone={STATUS_TONE[g.status]}>{g.status}</Pill>
            <QuickPlay me={me} connected={connected} />
            <span className="os-sub">pot {formatGnot(2 * g.stake)}</span>
        </div>
        {note && <div className="os-note" role="status">{note}</div>}
        <TxError message={txError} onDismiss={tx.clearError} action={txAction} />

        {!["open", "playing"].includes(g.status) && <div className="c4-banner" role="status" data-tone={won ? "win" : lost ? "lose" : undefined}>
            <span>{result(g, me)}{won && <small>The pot is on its way to your wallet.</small>}</span>
        </div>}
        {g.status === "open" && <div className="os-note" role="status">Waiting for an opponent · offer {now >= g.expiresAt ? "expired" : `expires in ${fmtSeconds(g.expiresAt - now)}`}</div>}
        {needsReveal && <div className={expired ? "os-note os-warn" : "os-note"} role="status">
            {g.revealed ? "Waiting for the acceptor to reveal their seed" : "Waiting for the creator to reveal"} · {expired ? "reveal clock ran out" : `${fmtSeconds(left)} left`}
            {isAcceptor && !g.revealed && !expired && " · keep this tab open: your seed is revealed right after."}
        </div>}
        {myReveal && !expired && !key && <div className="os-note os-err" role="alert">Your reveal key isn't on this device; you'll forfeit when the 90s runs out.</div>}

        <div className="c4-arena">
            <Board game={g} piece={piece} canPlay={myTurn && !tx.pending} onPlay={(c) => void run(() => play(me, g.id, c, g.moves, plain), () => play(me, g.id, c, g.moves, wallet), canPlay)} />
            <div className="c4-side">
                {live && <div className="c4-turn" role="status" data-mine={myTurn}>{quick && <span aria-label="Signed by Quick play" title="Signed by Quick play">⚡ </span>}{turnText}<small>{expired ? "clock ran out" : `${fmtSeconds(left)} left`}</small></div>}
                <PlayerCard colour="red" label="Creator" addr={g.creator} me={me} active={live && g.turn === 1} left={left} />
                <PlayerCard colour="yellow" label="Acceptor" addr={g.acceptor} me={me} active={live && g.turn === 2} left={left} />
                <dl className="c4-stats">
                    <dt>Stake each</dt><dd>{formatGnot(g.stake)}</dd>
                    <dt>Winner gets</dt><dd>{formatGnot(2 * g.stake - g.fee)}</dd>
                    <dt>Moves</dt><dd>{g.moves}</dd>
                </dl>
                <div className="os-row">
                    {myReveal && key && !unknown && <button type="button" className="os-btn c4-cta" disabled={tx.pending} onClick={() => void doReveal(key)}>Reveal</button>}
                    {expired && <button type="button" className="os-btn c4-cta" disabled={tx.pending} onClick={() => void run(() => claimTimeout(me, g.id, plain), () => claimTimeout(me, g.id, wallet), stillPlaying)}>Claim timeout</button>}
                    {connected && g.status === "open" && (isCreator || now >= g.expiresAt) && <button type="button" className="os-btn os-quiet" disabled={tx.pending} onClick={() => void tx.run(() => cancel(me, g.id, broadcast))}>Cancel</button>}
                    {isPlayer && g.status === "playing" && <button type="button" className="os-btn os-quiet" disabled={tx.pending} onClick={() => void tx.run(() => resign(me, g.id, broadcast))}>Resign</button>}
                </div>
            </div>
        </div>
    </div>
}

const MOVE_SECONDS = 90
const RING = 2 * Math.PI * 18

function PlayerCard({ colour, label, addr, me, active, left }: { colour: "red" | "yellow"; label: string; addr: string; me: string; active: boolean; left: number }) {
    const secs = Math.max(0, Math.min(MOVE_SECONDS, left))
    const level = secs <= 15 ? "danger" : secs <= 30 ? "warn" : "ok"
    return <div className={`c4-player c4-${colour}-turn`} data-active={active}>
        <span className={`c4-player-disc c4-${colour}`} aria-hidden="true" />
        <span className="os-grow">
            <b>{addr ? (addr === me ? "You" : shortAddr(addr)) : "Waiting…"}</b>
            <small>{label}{active ? " · on turn" : ""}</small>
        </span>
        {active && <span className="c4-clock" data-level={level} aria-hidden="true">
            <svg viewBox="0 0 44 44"><circle className="c4-clock-track" cx="22" cy="22" r="18" /><circle className="c4-clock-fill" cx="22" cy="22" r="18" strokeDasharray={RING} strokeDashoffset={RING * (1 - secs / MOVE_SECONDS)} /></svg>
            <span>{secs}</span>
        </span>}
    </div>
}
