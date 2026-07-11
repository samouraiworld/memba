import { describe, expect, it } from "vitest"
import { ARCHETYPES, buildWaves, WAVE_TOTAL } from "./waves"
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
        for (let i = 1; i < WAVE_TOTAL - 1; i++) {
            expect(waves[i].spawns.length).toBeGreaterThanOrEqual(waves[i - 1].spawns.length)
        }
    })

    it("worst-case script makespan fits the run cap — winning is reachable by construction", () => {
        // Review finding: v0 windows summed to ~2.3x the cap, so every run
        // died at RUN_MAX_TICKS and the "won" branch was unreachable. This
        // bound must hold for ANY seed: per wave, the last possible spawn +
        // a full crossing of the slowest archetype in that wave's pool +
        // the between-wave choice window.
        const CHOICE_TICKS = 120
        for (const seed of ["a", "b", "membas-2026"]) {
            let total = 0
            for (const w of buildWaves(seed)) {
                const lastSpawn = Math.max(...w.spawns.map((s) => s.atTick))
                const slowest = Math.min(...w.spawns.map((s) => ARCHETYPES[s.archetype].speed))
                total += lastSpawn + Math.ceil(LANE_LENGTH / slowest) + CHOICE_TICKS
            }
            expect(total).toBeLessThan(RUN_MAX_TICKS * 0.95)
        }
    })

    it("uses every lane from wave 2 on", () => {
        for (const w of buildWaves("lanes").slice(1)) {
            expect(new Set(w.spawns.map((s) => s.lane)).size).toBe(3)
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
