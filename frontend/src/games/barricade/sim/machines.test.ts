// B2 draft — sim/machines.test.ts (Core-6 completion: rampart, charger, flanker, mortar)
import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick, CHARGE_AT, FLANK_AT, MORTAR_PERIOD, MORTAR_SHELL, MORTAR_STANDOFF } from "./engine"
import { hashState, runReplay } from "./replay"
import { ARCHETYPES, THREAT_COST } from "./waves"
import type { Enemy } from "./types"
import type { WaveScript } from "./waves"

const NO_SPAWNS: WaveScript[] = [{ wave: 0, spawns: [] }]
const DECOY: Enemy = { id: 99, archetype: "drone", lane: 2, pos: 10_000, hp: 9_999_999, speed: 0, bornTick: 0, hasFlanked: false }
const mk = (id: number, archetype: Enemy["archetype"], lane: number, pos: number, over: Partial<Enemy> = {}): Enemy => ({
    id,
    archetype,
    lane,
    pos,
    hp: ARCHETYPES[archetype].hp,
    speed: ARCHETYPES[archetype].speed,
    bornTick: 0,
    hasFlanked: false,
    ...over,
})

describe("charger", () => {
    it("moves at base speed before the charge line and doubles past it", () => {
        let s = { ...initState("b2"), enemies: [mk(0, "charger", 0, CHARGE_AT - 10_000), mk(1, "charger", 1, CHARGE_AT), DECOY] }
        s = tick(s, NO_SPAWNS)
        const spd = ARCHETYPES.charger.speed
        expect(s.enemies.find((e) => e.id === 0)?.pos).toBe(CHARGE_AT - 10_000 + spd) // pre-line: base
        expect(s.enemies.find((e) => e.id === 1)?.pos).toBe(CHARGE_AT + spd * 2) // past the line: doubled
    })

    it("fire-slow composes with the charge (slowed doubled speed, floored)", () => {
        let s = {
            ...initState("b2"),
            hazards: [{ id: 0, lane: 0, posLo: 0, posHi: 100_000, dmgPerTick: 0, expiresAtTick: 1_000 }],
            enemies: [mk(0, "charger", 0, CHARGE_AT, { hp: 9_999_999 }), DECOY],
        }
        s = tick(s, NO_SPAWNS)
        const spd = ARCHETYPES.charger.speed
        expect(s.enemies.find((e) => e.id === 0)?.pos).toBe(CHARGE_AT + Math.floor((spd * 2 * 3) / 5))
    })
})

describe("flanker", () => {
    it("hops once to the least-crowded lane at the flank line (lowest index tiebreak)", () => {
        // lane 0: the flanker + a drone. lane 1: two drones. lane 2: one drone.
        // Least crowded = lane 2 → it hops there and never hops again.
        let s = {
            ...initState("b2"),
            enemies: [
                mk(0, "flanker", 0, FLANK_AT),
                mk(1, "drone", 0, 20_000),
                mk(2, "drone", 1, 20_000),
                mk(3, "drone", 1, 30_000),
                mk(4, "drone", 2, 20_000),
            ],
        }
        s = tick(s, NO_SPAWNS)
        const f = s.enemies.find((e) => e.id === 0)
        expect(f?.lane).toBe(2)
        expect(f?.hasFlanked).toBe(true)
        const laneAfter = f?.lane
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.lane).toBe(laneAfter) // one-shot
    })

    it("ties break to the lowest lane index", () => {
        let s = { ...initState("b2"), enemies: [mk(0, "flanker", 2, FLANK_AT)] } // all lanes empty(ish)
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.lane).toBe(0)
    })

    it("sequential evaluation: an earlier flanker's hop counts for the next one's crowd math", () => {
        let s = {
            ...initState("b2"),
            enemies: [mk(0, "flanker", 1, FLANK_AT), mk(1, "flanker", 1, FLANK_AT)],
        }
        s = tick(s, NO_SPAWNS)
        const lanes = s.enemies.filter((e) => e.archetype === "flanker").map((e) => e.lane)
        expect(new Set(lanes).size).toBe(2) // they split, not stack
    })
})

describe("mortar", () => {
    it("halts at its standoff line and never advances past it", () => {
        let s = { ...initState("b2"), enemies: [mk(0, "mortar", 0, MORTAR_STANDOFF - 100), DECOY] }
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.pos).toBe(MORTAR_STANDOFF)
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.pos).toBe(MORTAR_STANDOFF)
    })

    it("shells the barricade on its born-tick cadence while halted", () => {
        // bornTick 0 → volleys when (tick - bornTick) % MORTAR_PERIOD === 0.
        // Lane 1 keeps it out of the player's auto-fire for the whole period.
        let s = { ...initState("b2"), enemies: [mk(0, "mortar", 1, MORTAR_STANDOFF), DECOY] }
        const hp0 = s.barricadeHp
        for (let i = 0; i < MORTAR_PERIOD; i++) s = tick(s, NO_SPAWNS)
        expect(s.barricadeHp).toBe(hp0 - MORTAR_SHELL)
        expect(s.cleanWave).toBe(false)
    })

    it("does not shell while still marching to the line", () => {
        let s = { ...initState("b2"), enemies: [mk(0, "mortar", 0, 0)], barricadeHp: 100_000 }
        s = tick(s, NO_SPAWNS)
        expect(s.barricadeHp).toBe(100_000)
    })

    it("dies to a molotov lobbed onto the standoff line", () => {
        let s = { ...initState("b2"), enemies: [mk(0, "mortar", 1, MORTAR_STANDOFF, { hp: 5_000 }), DECOY] }
        s = applyEvent(s, { tick: 0, type: "throw", lane: 1, dist: MORTAR_STANDOFF })
        for (let i = 0; i < 30; i++) s = tick(s, NO_SPAWNS)
        expect(s.enemies.some((e) => e.id === 0)).toBe(false)
    })
})

describe("new fields + determinism", () => {
    it("every spawn stamps bornTick with its spawn tick", () => {
        // Lane 1: off the player's lane so auto-fire can't erase the evidence.
        const script: WaveScript[] = [{ wave: 0, spawns: [{ atTick: 5, lane: 1, archetype: "drone" }] }]
        let s = initState("b2")
        for (let i = 0; i < 6; i++) s = tick(s, script)
        expect(s.enemies[0]?.bornTick).toBe(5)
    })

    it("hashState covers bornTick and hasFlanked", () => {
        const base = { ...initState("b2"), enemies: [mk(0, "drone", 0, 1_000)] }
        expect(hashState({ ...base, enemies: [{ ...base.enemies[0], bornTick: 7 }] })).not.toBe(hashState(base))
        expect(hashState({ ...base, enemies: [{ ...base.enemies[0], hasFlanked: true }] })).not.toBe(hashState(base))
    })

    it("threat costs exist for the full core six", () => {
        for (const a of ["rampart", "charger", "flanker", "mortar"] as const) {
            expect(THREAT_COST[a]).toBeGreaterThan(0)
            expect(ARCHETYPES[a].hp).toBeGreaterThan(0)
        }
    })

    it("a seeded run with the new machines is replay-deterministic", () => {
        const seed = "barricade-2026-08-01"
        const a = runReplay(seed, [{ tick: 100, type: "move", lane: 1 }])
        const b = runReplay(seed, [{ tick: 100, type: "move", lane: 1 }])
        expect(a.stateHash).toBe(b.stateHash)
    })
})
