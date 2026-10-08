import { useId, useRef, useState, type KeyboardEvent } from "react"
import { Loading } from "../../os/kit"
import { formatGnot, shortAddr, useLeaders } from "./useConnect4"
import "./connect4.css"

const BOARDS = [
    { key: "wins", label: "Wins", title: "Most games won" },
    { key: "gnot", label: "GNOT won", title: "Most GNOT won" },
] as const
type Board = (typeof BOARDS)[number]["key"]

/** The realm's two top-10 boards in one card; the viewer's own row is marked "You". */
export function Leaders({ me }: { me: string }) {
    const { data, isLoading } = useLeaders()
    const [board, setBoard] = useState<Board>("wins")
    const id = useId()
    const tabs = useRef<(HTMLButtonElement | null)[]>([])
    const rows = data?.[board] ?? []
    // Two tabs: either arrow key moves to the other one.
    const onKey = (e: KeyboardEvent, i: number) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
        e.preventDefault()
        const next = BOARDS[1 - i]
        setBoard(next.key)
        tabs.current[1 - i]?.focus()
    }

    return <section className="c4-fame" aria-labelledby={`${id}-h`}>
        <div className="c4-fame-head">
            <h3 id={`${id}-h`}>Hall of fame</h3>
            <div className="c4-fame-tabs" role="tablist" aria-label="Leaderboard">
                {BOARDS.map((b, i) => <button key={b.key} ref={(el) => { tabs.current[i] = el }} type="button" role="tab" id={`${id}-${b.key}`}
                    aria-selected={board === b.key} aria-controls={`${id}-panel`} tabIndex={board === b.key ? 0 : -1}
                    title={b.title} onClick={() => setBoard(b.key)} onKeyDown={(e) => onKey(e, i)}>{b.label}</button>)}
            </div>
        </div>
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${board}`}>
            {isLoading ? <Loading label="Loading leaderboard…" />
                : !data ? <p className="os-sub">Couldn't load the leaderboard. Retrying…</p>
                : rows.length === 0 ? <p className="os-sub">No finished games yet. Win one to claim the top spot.</p>
                : <ol className="c4-fame-list">
                    {rows.map((r, i) => <li key={r.addr} className="c4-fame-row" data-rank={i < 3 ? i + 1 : undefined} data-me={r.addr === me || undefined}>
                        <span className="c4-medal" aria-hidden="true">{i + 1}</span>
                        <span className="c4-fame-who" title={r.addr}>{r.addr === me ? "You" : shortAddr(r.addr)}</span>
                        <b className="c4-fame-score">{board === "wins" ? `${r.score} ${r.score === 1 ? "win" : "wins"}` : formatGnot(r.score)}</b>
                    </li>)}
                </ol>}
        </div>
    </section>
}
