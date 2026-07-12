import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "./engine"
import { buildWaves } from "./waves"
import { LANE_LENGTH, RALLY_FULL, RUN_MAX_TICKS, type SimState } from "./types"

const MOLOTOV_COST = 1_000 // mirrors engine.ts

/**
 * A deterministic greedy REFERENCE player. It is not optimal — a real player has
 * more finesse — but it is competent: repair between waves, defend the most-
 * pressured lane, molotov the front cluster, rally when the meter is full. If
 * THIS can clear the daily curve on every sampled seed, the curve is fair: a
 * shared daily seed never hands anyone an unsurvivable run. This replaces the
 * old makespan bound with an actual playability proof, and it gates every future
 * difficulty/economy retune.
 */
function play(seed: string): SimState {
    let s = initState(seed)
    const waves = buildWaves(seed)
    let guard = 0
    while (s.phase !== "won" && s.phase !== "lost" && guard++ < RUN_MAX_TICKS + 50) {
        if (s.phase === "choice") {
            s = applyEvent(s, { tick: s.tick, type: "choice", choice: "repair" })
        } else {
            if (s.rallyMeter >= RALLY_FULL) s = applyEvent(s, { tick: s.tick, type: "rally" })
            // Most-pressured lane = the one whose front machine is nearest the barricade.
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
    }
    return s
}

describe("winnability (fairness on a shared daily seed)", () => {
    it("a greedy reference player clears the daily curve on every sampled seed", () => {
        const seeds = ["barricade-2026-07-12", "a", "b", "membas", "day-9", "seed-xyz", "2026-01-01", "zzz", "hello", "42"]
        for (const seed of seeds) {
            const final = play(seed)
            expect(
                final.phase,
                `seed "${seed}" ended ${final.phase} at tick ${final.tick}, barricade ${final.barricadeHp}, wave ${final.wave}`,
            ).toBe("won")
        }
    })
})
