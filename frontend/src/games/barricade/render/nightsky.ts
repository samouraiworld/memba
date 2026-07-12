/**
 * Procedural night skyline — deterministic building silhouettes for the horizon.
 *
 * Built once from a fixed-seed LCG so the city is stable across frames and
 * sessions (it must never flicker or reshuffle). Pure data — fractions of the
 * field width and of the sky-band height — so it scales to any canvas size; the
 * actual painting + searchlights live in draw.ts. No sim, no clock, no DOM.
 */

export type Building = { x: number; w: number; h: number; windows: number[] }

let cached: Building[] | undefined

/** A left-to-right row of buildings as unit fractions; cached after first call. */
export function buildSkyline(): Building[] {
    if (cached) return cached
    const out: Building[] = []
    let seed = 0x9e3779b1 >>> 0
    const rnd = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 0x100000000
    }
    let x = 0
    while (x < 1) {
        const w = Math.min(0.035 + rnd() * 0.05, 1 - x)
        const h = 0.35 + rnd() * 0.65
        const windows: number[] = []
        const n = Math.floor(rnd() * 3)
        for (let i = 0; i < n; i++) windows.push(0.15 + rnd() * 0.7)
        out.push({ x, w, h, windows })
        x += w + rnd() * 0.012
    }
    cached = out
    return out
}
