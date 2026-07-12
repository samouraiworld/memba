import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "./engine"
import { buildWaves } from "./waves"
import { LANE_LENGTH, RALLY_FULL, RUN_MAX_TICKS, type SimState } from "./types"

const MOLOTOV_COST = 1_000 // mirrors engine.ts

/**
 * A deterministic greedy REFERENCE player: repair between waves, defend the most-
 * pressured lane, molotov the front cluster, rally when full. `reactEvery`
 * handicaps reaction speed — 1 acts every tick (near-perfect), 2 acts every other
 * tick (closer to a human). Returns the terminal state + the lowest barricade HP
 * reached (the survival margin).
 *
 * If a human-PACED player clears every REAL daily seed with margin, the shared
 * daily seed is fair — nobody is handed an unsurvivable run. This is the fairness
 * guard that gates every future difficulty/economy retune.
 */
function play(seed: string, reactEvery = 1): { final: SimState; minHp: number } {
    let s = initState(seed)
    const waves = buildWaves(seed)
    let minHp = s.barricadeHp
    let guard = 0
    while (s.phase !== "won" && s.phase !== "lost" && guard++ < RUN_MAX_TICKS + 50) {
        if (s.phase === "choice") {
            s = applyEvent(s, { tick: s.tick, type: "choice", choice: "repair" })
        } else if (s.tick % reactEvery === 0) {
            if (s.rallyMeter >= RALLY_FULL) s = applyEvent(s, { tick: s.tick, type: "rally" })
            let lane = -1
            let best = -1
            for (const e of s.enemies) {
                if (e.pos > best) {
                    best = e.pos
                    lane = e.lane
                }
            }
            if (lane >= 0) {
                if (s.playerLane !== lane) s = applyEvent(s, { tick: s.tick, type: "move", lane })
                let front = -1
                for (const e of s.enemies) if (e.lane === lane && e.pos > front) front = e.pos
                if (front >= 0 && s.molotovCharge >= MOLOTOV_COST && s.tick >= s.molotovReadyAt) {
                    // Lead the throw so the burst + fire land on the advancing front.
                    s = applyEvent(s, { tick: s.tick, type: "throw", lane, dist: Math.min(LANE_LENGTH, front + 10_000) })
                }
            }
        }
        s = tick(s, waves)
        if (s.barricadeHp < minHp) minHp = s.barricadeHp
    }
    return { final: s, minHp }
}

// The real production seed format is `barricade-${ISO date}` (see Barricade.tsx
// dailySeed()) — sample the seeds that will actually be PLAYED, not ad-hoc strings.
function dailySeeds(count: number): string[] {
    const out: string[] = []
    const start = Date.UTC(2026, 0, 1)
    for (let d = 0; d < count; d++) out.push(`barricade-${new Date(start + d * 86_400_000).toISOString().slice(0, 10)}`)
    return out
}

describe("winnability (fairness on a shared daily seed)", () => {
    it("a competent reference player clears assorted seeds", () => {
        for (const seed of ["barricade-2026-07-12", "a", "membas", "zzz", "42"]) {
            expect(play(seed).final.phase, `seed ${seed}`).toBe("won")
        }
    })

    // 90 real daily seeds is a strong fairness sample; the explicit timeout keeps
    // the full-game sweep from flaking on a slow CI runner (it runs ~3s there).
    it("a human-paced player clears every real daily seed for a quarter, keeping a margin", () => {
        let worstMargin = Infinity
        for (const seed of dailySeeds(90)) {
            const { final, minHp } = play(seed, 2) // acts every other tick
            expect(final.phase, `seed ${seed}: ${final.phase} @tick ${final.tick}, hp ${final.barricadeHp}`).toBe("won")
            if (minHp < worstMargin) worstMargin = minHp
        }
        // A real cushion, not a photo-finish: even the tightest day never drops
        // below ~5% barricade for the human-paced player.
        expect(worstMargin).toBeGreaterThan(5_000)
    }, 20_000)
})
