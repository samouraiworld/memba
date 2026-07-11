import { describe, expect, it } from "vitest"
import { ARCHETYPES, buildWaves } from "./waves"

describe("wave scripts", () => {
    it("is deterministic per seed and varies across seeds", () => {
        expect(buildWaves("day-1")).toEqual(buildWaves("day-1"))
        expect(JSON.stringify(buildWaves("day-1"))).not.toEqual(JSON.stringify(buildWaves("day-2")))
    })

    it("ships 13 waves with a single boss in the last", () => {
        const waves = buildWaves("day-1")
        expect(waves).toHaveLength(13)
        const last = waves[12]
        expect(last.spawns.filter((s) => s.archetype === "broadcast")).toHaveLength(1)
        for (let i = 1; i < 12; i++) {
            expect(waves[i].spawns.length).toBeGreaterThanOrEqual(waves[i - 1].spawns.length)
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
