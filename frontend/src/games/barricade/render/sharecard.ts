/**
 * Share-card text composer — the GDD growth engine, Wordle-style.
 *
 * Turns a finished run into a compact, spoiler-free brag the player can paste
 * anywhere: the verdict, the score, and a wave grid (cleared / where the line
 * fell / never reached). It deliberately reveals nothing about the day's enemy
 * layout — only how far you got — so sharing can't help anyone game the seed.
 * Pure string building: no clipboard, no sim, no DOM (the copy happens in the
 * shell, on an explicit tap — never auto-shared).
 */

export type ShareResult = {
    score: number
    won: boolean
    waves: number // 1-indexed wave reached (where it ended)
    total: number // WAVE_TOTAL
    date: string // e.g. "2026-07-12"
    url?: string // optional link, appended when the game is public
}

const CLEARED = "🟩"
const FELL = "🟥"
const UNREACHED = "⬛"

export function buildShareText(r: ShareResult): string {
    const grid = Array.from({ length: r.total }, (_, i) => {
        const wave = i + 1
        if (r.won || wave < r.waves) return CLEARED
        if (wave === r.waves) return FELL
        return UNREACHED
    }).join("")
    const verdict = r.won ? "THE LINE HELD" : "THE LINE FELL"
    const lines = [
        `MEMBA: BARRICADE — ${r.date}`,
        `${verdict} · ${r.score.toLocaleString()} · wave ${r.waves}/${r.total}`,
        grid,
    ]
    if (r.url) lines.push(r.url)
    return lines.join("\n")
}
