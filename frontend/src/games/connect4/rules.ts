export const COLS = 7
export const ROWS = 6

export const cell = (board: string, c: number, r: number) => board[c * ROWS + r] as "0" | "1" | "2"
export const columnFull = (board: string, c: number) => cell(board, c, ROWS - 1) !== "0"

const DIRS: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]]

/** The first four-in-a-row on the board, or []. */
export function winLine(board: string): Array<[number, number]> {
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
        const p = cell(board, c, r)
        if (p === "0") continue
        for (const [dc, dr] of DIRS) {
            const line: Array<[number, number]> = [[c, r]]
            for (let i = 1; i < 4; i++) {
                const x = c + dc * i, y = r + dr * i
                if (x < 0 || x >= COLS || y < 0 || y >= ROWS || cell(board, x, y) !== p) break
                line.push([x, y])
            }
            if (line.length === 4) return line
        }
    }
    return []
}
