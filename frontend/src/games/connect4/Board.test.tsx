import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Board } from "./Board"
import { cell, columnFull, winLine } from "./rules"
import type { Game } from "../../lib/connect4"

const empty = "0".repeat(42)
const put = (board: string, c: number, r: number, p: "1" | "2") => {
    const a = board.split(""); a[c * 6 + r] = p; return a.join("")
}
const game = (board: string, extra: Partial<Game> = {}): Game => ({
    id: 1, creator: "g1a", opponent: "", acceptor: "g1b", stake: 1, fee: 0, expiresAt: 0, commitment: "", seedCommitment: "", revealed: true, board,
    turn: 1, turnPlayer: "g1a", moves: 0, lastCol: 0, lastRow: 0, deadline: 0, status: "playing", winner: "", ...extra,
})

describe("board helpers", () => {
    it("reads column-major with row 0 at the bottom", () => {
        expect(cell(put(empty, 2, 0, "1"), 2, 0)).toBe("1")
    })
    it("detects a full column", () => {
        let b = empty
        for (let r = 0; r < 6; r++) b = put(b, 4, r, r % 2 ? "1" : "2")
        expect(columnFull(b, 4)).toBe(true)
        expect(columnFull(b, 3)).toBe(false)
    })
    it("finds horizontal, vertical and both diagonal lines", () => {
        let h = empty; for (let c = 1; c < 5; c++) h = put(h, c, 0, "1")
        expect(winLine(h)).toHaveLength(4)
        let v = empty; for (let r = 0; r < 4; r++) v = put(v, 6, r, "2")
        expect(winLine(v)).toEqual(expect.arrayContaining([[6, 0], [6, 3]]))
        let d = empty; for (let i = 0; i < 4; i++) d = put(d, i, i, "1")
        expect(winLine(d)).toHaveLength(4)
        let a = empty; for (let i = 0; i < 4; i++) a = put(a, i, 3 - i, "2")
        expect(winLine(a)).toHaveLength(4)
        expect(winLine(put(put(put(empty, 0, 0, "1"), 1, 0, "1"), 2, 0, "1"))).toEqual([])
    })
})

describe("Board", () => {
    it("plays a 1-based column and disables full columns", () => {
        const onPlay = vi.fn()
        let b = empty
        for (let r = 0; r < 6; r++) b = put(b, 0, r, "2")
        render(<Board game={game(b)} canPlay onPlay={onPlay} />)
        expect(screen.getByRole("button", { name: /^Drop in column 1:/ })).toBeDisabled()
        fireEvent.click(screen.getByRole("button", { name: /^Drop in column 3:/ }))
        expect(onPlay).toHaveBeenCalledWith(3)
    })
    it("disables every column when it cannot play", () => {
        render(<Board game={game(empty)} canPlay={false} onPlay={vi.fn()} />)
        for (let c = 1; c <= 7; c++) expect(screen.getByRole("button", { name: new RegExp(`^Drop in column ${c}:`) })).toBeDisabled()
    })
    it("shows both last-move and winning-line markers on the winning cell", () => {
        let b = empty
        // Create a horizontal four-in-a-row for player 1 at row 0, columns 0-3
        for (let c = 0; c < 4; c++) b = put(b, c, 0, "1")
        const { container } = render(
            <Board game={game(b, { moves: 4, lastCol: 3, lastRow: 0 })} canPlay onPlay={vi.fn()} />
        )
        // The winning cell (column 3, row 0) should have both classes
        expect(container.querySelectorAll('.c4-last.c4-win')).toHaveLength(1)
    })
    it("describes each column's discs and announces the last move", () => {
        const b = put(put(empty, 2, 0, "1"), 2, 1, "2")
        render(<Board game={game(b, { moves: 2, lastCol: 2, lastRow: 1 })} canPlay={false} onPlay={vi.fn()} />)
        expect(screen.getByRole("button", { name: "Drop in column 3: red, yellow, 4 empty" })).toBeDisabled()
        expect(screen.getByRole("button", { name: "Drop in column 1: 6 empty" })).toBeInTheDocument()
        expect(screen.getByText("Last move: yellow in column 3.")).toHaveAttribute("aria-live", "polite")
    })
})
