import type { CSSProperties } from "react"
import type { Game } from "../../lib/connect4"
import { COLS, ROWS, cell, columnFull, winLine } from "./rules"
import "./connect4.css"

/** `piece` is the viewer's colour ("1" creator, "2" acceptor): it tints the drop preview. */
export function Board({ game, canPlay, onPlay, piece }: { game: Game; canPlay: boolean; onPlay: (column: number) => void; piece?: "1" | "2" }) {
    const win = new Set(winLine(game.board).map(([c, r]) => `${c}:${r}`))
    return <div className="c4-board" role="group" aria-label="Connect 4 board" data-piece={piece}>
        {Array.from({ length: COLS }, (_, c) => (
            <button key={c} type="button" className="c4-col" aria-label={`Drop in column ${c + 1}`}
                disabled={!canPlay || columnFull(game.board, c)} onClick={() => onPlay(c + 1)}>
                <span className="c4-ghost" aria-hidden="true" />
                {Array.from({ length: ROWS }, (_, i) => {
                    const r = ROWS - 1 - i
                    const p = cell(game.board, c, r)
                    const last = game.moves > 0 && game.lastCol === c && game.lastRow === r
                    // The last disc falls from above the board: --fall is how many slots it drops.
                    const style = last ? ({ "--fall": ROWS - r } as CSSProperties) : undefined
                    return <span key={r} className={`c4-cell c4-p${p}${last ? " c4-last" : ""}${win.has(`${c}:${r}`) ? " c4-win" : ""}`}>
                        {p !== "0" && <i className="c4-disc" style={style} />}
                    </span>
                })}
            </button>
        ))}
    </div>
}
