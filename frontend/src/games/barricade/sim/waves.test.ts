import { describe, expect, it } from "vitest"
import { ARCHETYPES, buildWaves, THREAT_COST, WAVE_TOTAL } from "./waves"
import { LANE_LENGTH, RUN_MAX_TICKS } from "./types"

describe("wave scripts", () => {
    it("is deterministic per seed and varies across seeds", () => {
        expect(buildWaves("day-1")).toEqual(buildWaves("day-1"))
        expect(JSON.stringify(buildWaves("day-1"))).not.toEqual(JSON.stringify(buildWaves("day-2")))
    })

    it("ships WAVE_TOTAL waves with a single boss in the last", () => {
        const waves = buildWaves("day-1")
        expect(waves).toHaveLength(WAVE_TOTAL)
        const last = waves[WAVE_TOTAL - 1]
        expect(last.spawns.filter((s) => s.archetype === "broadcast")).toHaveLength(1)
        // v2: the threat DELIVERED per wave (sum of spawn costs) rises with the
        // budget — raw spawn count no longer does, since later waves buy pricier
        // machines for the same budget.
        const threat = (w: (typeof waves)[number]) => w.spawns.reduce((t, sp) => t + THREAT_COST[sp.archetype], 0)
        for (let i = 1; i < WAVE_TOTAL - 1; i++) {
            expect(threat(waves[i])).toBeGreaterThanOrEqual(threat(waves[i - 1]))
        }
    })

    it("worst-case script makespan fits the run cap — winning is reachable by construction", () => {
        // Review finding: v0 windows summed to ~2.3x the cap, so every run
        // died at RUN_MAX_TICKS and the "won" branch was unreachable. This
        // bound must hold for ANY seed: per wave, the last possible spawn +
        // a full crossing of the slowest archetype in that wave's pool +
        // the between-wave choice window.
        // Base speed is conservative vs escalation (escalated speed is only ever
        // faster), NOT vs player-inflicted fire-slow/shove — but stalling is the
        // player's own choice, which a fairness bound may ignore. Swept over ten
        // years of production-format seeds (buildWaves is cheap), not ad-hoc ones.
        const CHOICE_TICKS = 120
        const start = Date.UTC(2026, 0, 1)
        for (let d = 0; d < 3_650; d++) {
            const seed = `barricade-${new Date(start + d * 86_400_000).toISOString().slice(0, 10)}`
            let total = 0
            for (const w of buildWaves(seed)) {
                const lastSpawn = Math.max(...w.spawns.map((s) => s.atTick))
                const slowest = Math.min(...w.spawns.map((s) => ARCHETYPES[s.archetype].speed))
                total += lastSpawn + Math.ceil(LANE_LENGTH / slowest) + CHOICE_TICKS
            }
            expect(total, seed).toBeLessThan(RUN_MAX_TICKS * 0.95)
        }
    })

    it("uses every lane from wave 2 on — swept over ten years of real daily seeds", () => {
        // Review finding: the coverage pass computed `used` once and then donated
        // the LAST spawn to a missing lane without checking the donor lane kept
        // another occupant — so on ~2.4% of production seeds it emptied the lane
        // it robbed (hit the served seed barricade-2026-07-04). One ad-hoc seed
        // here kept CI green; sweep the real seed format instead (buildWaves only,
        // runs in milliseconds).
        const start = Date.UTC(2026, 0, 1)
        for (let d = 0; d < 3_650; d++) {
            const seed = `barricade-${new Date(start + d * 86_400_000).toISOString().slice(0, 10)}`
            for (const w of buildWaves(seed).slice(1, WAVE_TOTAL - 1)) {
                const lanes = new Set(w.spawns.map((s) => s.lane))
                expect(lanes.size, `${seed} wave ${w.wave}`).toBe(3)
            }
        }
    })

    it("archetype stats stay integer milli-units", () => {
        for (const a of Object.values(ARCHETYPES)) {
            expect(Number.isInteger(a.hp + a.speed + a.damage + a.scrap)).toBe(true)
            expect(a.hp).toBeGreaterThan(0)
            expect(a.speed).toBeGreaterThan(0)
        }
    })
})
