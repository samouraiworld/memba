/**
 * Enemy wind-up telegraph — pure, render-only threat selection.
 *
 * A lane-defense lives or dies on the player reading which lane is about to be
 * hit. This picks the FRONT unit (nearest the barricade) of each lane once it
 * has advanced past `TELEGRAPH_FRAC`, and reports how far into the warning band
 * it is (`intensity`, 0 at the threshold → 1 at the barricade) so the renderer
 * can escalate the tell. It never mutates its input and reads only positions, so
 * it can't change a replay — the sim is untouched.
 */

import { LANE_LENGTH } from "../sim/types"

/** Front unit past this fraction of the lane triggers a wind-up warning. */
export const TELEGRAPH_FRAC = 0.72

export type LaneThreat = { lane: number; frac: number; intensity: number }

/**
 * Given the live units (their lane + position in milli-units), return the front
 * unit per lane that has crossed `threshold`, sorted by lane for a stable draw
 * order. `frac`/`intensity` are derived; nothing is mutated.
 */
export function laneThreats(units: { lane: number; pos: number }[], threshold = TELEGRAPH_FRAC): LaneThreat[] {
    const frontFrac = new Map<number, number>()
    for (const u of units) {
        const frac = Math.min(1, u.pos / LANE_LENGTH)
        const cur = frontFrac.get(u.lane)
        if (cur === undefined || frac > cur) frontFrac.set(u.lane, frac)
    }
    const out: LaneThreat[] = []
    for (const [lane, frac] of frontFrac) {
        if (frac >= threshold) {
            out.push({ lane, frac, intensity: Math.min(1, (frac - threshold) / (1 - threshold)) })
        }
    }
    return out.sort((a, b) => a.lane - b.lane)
}
