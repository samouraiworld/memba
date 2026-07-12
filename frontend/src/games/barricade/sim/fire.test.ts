import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "./engine"
import { hashState } from "./replay"
import type { Enemy } from "./types"
import type { WaveScript } from "./waves"

const NO_SPAWNS: WaveScript[] = [{ wave: 0, spawns: [] }]
// Immortal, stationary decoy in an untouched lane keeps the wave from clearing.
const DECOY: Enemy = { id: 99, archetype: "drone", lane: 2, pos: 10_000, hp: 9_999_999, speed: 0, bornTick: 0, hasFlanked: false }
const at = (id: number, lane: number, pos: number, hp: number, speed = 0): Enemy => ({
    id,
    archetype: "drone",
    lane,
    pos,
    hp,
    speed,
    bornTick: 0,
    hasFlanked: false,
})

describe("molotov fire zone", () => {
    it("a molotov impact leaves a fire field at the target band", () => {
        let s: ReturnType<typeof initState> = { ...initState("f"), enemies: [DECOY] }
        s = applyEvent(s, { tick: 0, type: "throw", lane: 1, dist: 50_000 })
        for (let i = 0; i < 21; i++) s = tick(s, NO_SPAWNS) // impact at tick 21
        expect(s.projectiles).toHaveLength(0)
        expect(s.hazards).toHaveLength(1)
        expect(s.hazards[0]).toMatchObject({
            lane: 1,
            posLo: 41_000,
            posHi: 59_000,
            dmgPerTick: 500,
            expiresAtTick: 201,
        })
    })

    it("burns machines caught in it each tick (damage-over-time)", () => {
        let s: ReturnType<typeof initState> = {
            ...initState("f"),
            hazards: [{ id: 0, lane: 1, posLo: 40_000, posHi: 60_000, dmgPerTick: 500, expiresAtTick: 1_000 }],
            enemies: [at(0, 1, 50_000, 3_000), DECOY], // in-band; only fire can reach it
        }
        for (let i = 0; i < 5; i++) s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.hp).toBe(3_000 - 5 * 500) // 500
        s = tick(s, NO_SPAWNS) // 6th burn → dead
        expect(s.enemies.some((e) => e.id === 0)).toBe(false)
    })

    it("slows machines caught in it (−40%), but not those outside", () => {
        let s: ReturnType<typeof initState> = {
            ...initState("f"),
            hazards: [{ id: 0, lane: 1, posLo: 0, posHi: 100_000, dmgPerTick: 0, expiresAtTick: 1_000 }],
            enemies: [at(0, 1, 10_000, 9_999_999, 700), at(1, 2, 10_000, 9_999_999, 700)],
        }
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.pos).toBe(10_000 + 420) // 700 * 3/5, slowed
        expect(s.enemies.find((e) => e.id === 1)?.pos).toBe(10_000 + 700) // outside fire, full speed
    })

    it("burns out at expiresAtTick and is removed", () => {
        let s: ReturnType<typeof initState> = {
            ...initState("f"),
            hazards: [{ id: 0, lane: 1, posLo: 0, posHi: 100_000, dmgPerTick: 500, expiresAtTick: 3 }],
            enemies: [at(0, 1, 50_000, 9_999_999), DECOY],
        }
        s = tick(s, NO_SPAWNS) // tick 1: burns
        s = tick(s, NO_SPAWNS) // tick 2: burns
        const hpAfterBurn = s.enemies.find((e) => e.id === 0)?.hp
        s = tick(s, NO_SPAWNS) // tick 3: field expired → removed, no burn
        s = tick(s, NO_SPAWNS) // tick 4: no fire
        expect(s.hazards).toHaveLength(0)
        expect(s.enemies.find((e) => e.id === 0)?.hp).toBe(hpAfterBurn)
    })

    it("hashState covers the hazards field", () => {
        const base = initState("f")
        const withFire = { ...base, hazards: [{ id: 0, lane: 0, posLo: 1, posHi: 2, dmgPerTick: 3, expiresAtTick: 4 }] }
        expect(hashState(withFire)).not.toBe(hashState(base))
    })

    it("burns on the impact tick too — a machine at the center takes burst + one burn", () => {
        // High HP survives the burst, so the same-tick burn is observable.
        let s: ReturnType<typeof initState> = { ...initState("f"), enemies: [at(0, 1, 50_000, 100_000), DECOY] }
        s = applyEvent(s, { tick: 0, type: "throw", lane: 1, dist: 50_000 })
        for (let i = 0; i < 21; i++) s = tick(s, NO_SPAWNS) // impact at tick 21
        expect(s.enemies.find((e) => e.id === 0)?.hp).toBe(100_000 - 6_000 - 500)
    })
})
