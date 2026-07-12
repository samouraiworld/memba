import { describe, expect, it } from "vitest"
import { applyEvent, initState, PATCH_HP, REPAIR_COST, tick } from "./engine"
import { BOSS_WAVE, buildWaves } from "./waves"
import { BARRICADE_MAX_HP, LANE_LENGTH, RALLY_FULL, RUN_MAX_TICKS, type SimEvent, type SimState } from "./types"

const MOLOTOV_COST = 1_000 // mirrors engine.ts
const REPAIR_HP_WORTH = 9_000 // repair only when at least half of the +18k lands

/**
 * A deterministic greedy REFERENCE player: repair between waves, defend the most-
 * pressured lane, molotov the front cluster, rally when full.
 *
 * Honesty contract (review-hardened — the gate is only as good as this model):
 *  - ONE event per action tick. The old model could emit rally+move+throw in a
 *    single tick (up to 90 events/sec) — no human does that.
 *  - `reactEvery` is the action cadence in ticks; 15 ≈ 4 actions/sec.
 *  - Decisions read a SNAPSHOT one reaction interval old (perception latency):
 *    the player aims at where things were ~250ms ago, so the lead is naturally
 *    imperfect. applyEvent's own guards make stale-illegal actions no-ops,
 *    exactly like a mistimed human tap.
 *
 * If THIS player clears every real daily seed with a margin, the shared daily
 * seed is fair — nobody is handed an unsurvivable run. This gates every future
 * difficulty/economy retune.
 */
function decide(view: SimState): SimEvent | null {
    if (view.phase === "choice") {
        // The shop (v2 economy): repair while it's worth the scrap, fall back to
        // the free patch, then get back on the wall. One buy per action tick —
        // shopping takes taps too.
        if (view.barricadeHp <= BARRICADE_MAX_HP - REPAIR_HP_WORTH && view.scrap >= REPAIR_COST)
            return { tick: 0, type: "choice", choice: "repair" }
        if (!view.patchUsed && view.barricadeHp <= BARRICADE_MAX_HP - PATCH_HP)
            return { tick: 0, type: "choice", choice: "patch" }
        return { tick: 0, type: "choice", choice: "done" }
    }
    if (view.rallyMeter >= RALLY_FULL) return { tick: 0, type: "rally" }
    let lane = -1
    let front = -1
    for (const e of view.enemies) {
        if (e.pos > front) {
            front = e.pos
            lane = e.lane
        }
    }
    if (lane < 0) return null
    // A kettled street can't be entered — no human taps a visibly locked lane;
    // they lob into it from outside (tap-to-lob targets ANY lane by design).
    const kettled = view.enemies.some((e) => e.archetype === "kettle" && e.lane === lane)
    if (view.playerLane !== lane && !kettled) return { tick: 0, type: "move", lane }
    if (view.molotovCharge >= MOLOTOV_COST && view.tick >= view.molotovReadyAt) {
        // Lead the throw from the STALE view — where the front was, plus a guess.
        return { tick: 0, type: "throw", lane, dist: Math.min(LANE_LENGTH, front + 10_000) }
    }
    return null
}

function play(seed: string, reactEvery = 15): { final: SimState; minHp: number } {
    let s = initState(seed)
    const waves = buildWaves(seed)
    let minHp = s.barricadeHp
    let lagged = s // what the player last "saw" — one reaction interval stale
    let guard = 0
    while (s.phase !== "lost" && guard++ < RUN_MAX_TICKS + 50) {
        if (s.tick % reactEvery === 0) {
            const act = decide(lagged)
            if (act) s = applyEvent(s, { ...act, tick: s.tick } as SimEvent)
            lagged = s
        }
        s = tick(s, waves)
        // The fairness margin is an ARC property: overtime damage is designed
        // death, so the tightest moment BEFORE the boss falls is what counts.
        if (s.wave <= BOSS_WAVE && s.barricadeHp < minHp) minHp = s.barricadeHp
    }
    return { final: s, minHp }
}

// The real production seed format is `barricade-${ISO date}` (see Barricade.tsx
// dailySeed()) — sample the seeds that will actually be PLAYED. The window is
// fixed (deterministic CI) but covers the LIVE quarter; advance it each season.
function dailySeeds(count: number, startUtc: number): string[] {
    const out: string[] = []
    for (let d = 0; d < count; d++) out.push(`barricade-${new Date(startUtc + d * 86_400_000).toISOString().slice(0, 10)}`)
    return out
}

describe("winnability (fairness on a shared daily seed)", () => {
    it("a fast competent player clears the arc on assorted seeds (then the siege takes them all)", () => {
        for (const seed of ["barricade-2026-07-12", "a", "membas", "zzz", "42"]) {
            const { final } = play(seed, 2)
            expect(final.wave, `seed ${seed}`).toBeGreaterThan(BOSS_WAVE) // the arc was cleared
            expect(final.phase, `seed ${seed}`).toBe("lost") // …and the siege ended it, as designed
        }
    })

    // 90 real daily seeds covering the live quarter; the explicit timeout keeps
    // the full-game sweep from flaking on a slow CI runner.
    it("a human-paced player (4 acts/sec, ~250ms latency) clears every real daily seed for the live quarter, keeping a margin", () => {
        let worstMargin = Infinity
        for (const seed of dailySeeds(90, Date.UTC(2026, 6, 1))) {
            const { final, minHp } = play(seed)
            expect(final.wave, `seed ${seed}: wave ${final.wave} @tick ${final.tick}, hp ${final.barricadeHp}`).toBeGreaterThan(
                BOSS_WAVE,
            )
            // Death must come FROM THE SIEGE, never the tick cap: a retune that
            // drags honest runs toward the 15-minute ceiling would turn every
            // ending into an arbitrary cutoff — trip CI well before that.
            expect(final.phase, seed).toBe("lost")
            expect(final.tick, seed).toBeLessThan(RUN_MAX_TICKS * 0.8)
            if (minHp < worstMargin) worstMargin = minHp
        }
        // A floor that BINDS: with the B3 mini-bosses in the arc the honest
        // player's worst live-quarter margin measures ~25k (a quarter of the
        // barricade on the tightest day — harder, still clearly fair). The
        // floor sits at 10% so a retune that pushes any real seed toward
        // unwinnable trips CI before it ships.
        expect(worstMargin).toBeGreaterThan(10_000)
        // …and an anti-vacuity ceiling: if no seed ever scratches the honest
        // player, this sweep proves nothing about fairness under pressure
        // (review finding — pre-B3 the reference player was never touched and
        // the gate was inert). A retune that trivializes the game trips this.
        expect(worstMargin).toBeLessThan(BARRICADE_MAX_HP)
    }, 40_000) // the sweep now plays every seed THROUGH its overtime death
})
