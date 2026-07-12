/**
 * Sub-tick position interpolation — pure, render-only motion smoothing.
 *
 * The sim advances on a fixed 60Hz timestep (see hooks/useGameLoop); on a
 * 120/144Hz display that means most wall-clock frames repeat the previous tick's
 * positions, so motion visibly steps/judders. Given the state one tick ago
 * (`prev`), the current tick's state (`cur`), and `alpha` — the fraction of the
 * way from prev→cur that this frame falls (the loop's leftover accumulator over
 * FIXED_MS) — we return the smoothed position for each live enemy id.
 *
 * Only `pos` is lerped: pos advances by a per-tick speed (engine.ts step 2 —
 * constant except a charger's doubling or a fire-slow, both step functions a
 * one-tick lerp reproduces faithfully). A lane is fixed at spawn for every
 * machine EXCEPT the flanker, whose one-shot hop teleports the sprite sideways
 * on that frame — deliberately abrupt (it's a vault); a dedicated hop FX cue is
 * a Phase-D polish item. Enemies with no match in prev (spawned this tick) snap
 * to their current pos; enemies gone from cur (killed or reached the barricade)
 * are simply absent — their exit is the death-anim layer's job, not this one's.
 *
 * DETERMINISM: this reads sim state and never mutates it, and its output feeds
 * only the renderer — it can never change a replay. It touches no clock and no
 * randomness (all sub-tick timing arrives as `alpha` from the render loop).
 */

import type { SimState } from "../sim/types"

/** Map of live-in-`cur` enemy id → interpolated position (milli-units). */
export function interpPositions(prev: SimState, cur: SimState, alpha: number): Map<number, number> {
    const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha
    const prevPos = new Map<number, number>()
    for (const e of prev.enemies) prevPos.set(e.id, e.pos)
    const out = new Map<number, number>()
    for (const e of cur.enemies) {
        const p = prevPos.get(e.id)
        out.set(e.id, p === undefined ? e.pos : p + (e.pos - p) * a)
    }
    return out
}
