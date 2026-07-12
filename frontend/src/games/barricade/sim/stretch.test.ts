import { describe, expect, it } from "vitest"
import {
    initState,
    tick,
    CARRIER_PERIOD,
    CARRIER_LITTER,
    MENDER_PERIOD,
    MENDER_HEAL,
    BROADCAST_P2_HP,
    BROADCAST_P3_HP,
    BROADCAST_SHELL,
    BROADCAST_SHELL_PERIOD,
} from "./engine"
import { ARCHETYPES } from "./waves"
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
    speed: 0,
    bornTick: 0,
    hasFlanked: false,
    ...over,
})

describe("carrier (mobile spawner)", () => {
    it("deploys adds into its own AND a neighbor lane on its cadence", () => {
        let s = { ...initState("c1"), enemies: [mk(0, "carrier", 1, 30_000)], nextEnemyId: 1 }
        for (let i = 0; i < CARRIER_PERIOD; i++) s = tick(s, NO_SPAWNS)
        const kids = s.enemies.filter((e) => e.id !== 0)
        expect(kids.length).toBe(CARRIER_LITTER)
        const lanes = new Set(kids.map((k) => k.lane))
        expect(lanes.has(1)).toBe(true) // its own lane…
        expect(lanes.size).toBeGreaterThan(1) // …and a neighbor
    })
})

describe("jammer (presence denial)", () => {
    it("freezes rally fill while alive, releases on death", () => {
        // Kills that would fill the meter yield zero while a jammer stands.
        let s = {
            ...initState("c1"),
            playerLane: 0,
            enemies: [mk(0, "jammer", 1, 30_000, { hp: 9_999_999 }), mk(1, "drone", 0, 50_000, { hp: 1_000 })],
        }
        s = tick(s, NO_SPAWNS) // auto-fire kills the drone
        expect(s.enemies.some((e) => e.id === 1)).toBe(false)
        expect(s.rallyMeter).toBe(0) // jammed
    })

    it("disables the turret in its lane while alive", () => {
        let s = {
            ...initState("c1"),
            playerLane: 2,
            turrets: [0, 900, 0],
            enemies: [mk(0, "jammer", 1, 30_000, { hp: 9_999_999 }), mk(1, "drone", 1, 50_000, { hp: 1_000 }), DECOY],
        }
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.some((e) => e.id === 1)).toBe(true) // the lane-1 turret did nothing
    })
})

describe("mender (rear-guard healer)", () => {
    it("heals the machine directly ahead of it on its cadence, never past max", () => {
        let s = {
            ...initState("c1"),
            playerLane: 2,
            enemies: [mk(0, "mender", 1, 20_000), mk(1, "walker", 1, 40_000, { hp: 2_000 }), DECOY],
        }
        for (let i = 0; i < MENDER_PERIOD; i++) s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 1)?.hp).toBe(2_000 + MENDER_HEAL)
    })
})

describe("broadcast tower, three phases", () => {
    it("phase 2 (mid HP): the tower deploys menders", () => {
        let s = {
            ...initState("c1"),
            playerLane: 2,
            enemies: [mk(0, "broadcast", 1, 30_000, { hp: BROADCAST_P2_HP - 1 })],
            nextEnemyId: 1,
        }
        let sawMender = false
        for (let i = 0; i < 200 && !sawMender; i++) {
            s = tick(s, NO_SPAWNS)
            sawMender = s.enemies.some((e) => e.archetype === "mender")
        }
        expect(sawMender).toBe(true)
    })

    it("phase 3 (low HP): the tower shells the barricade itself", () => {
        let s = {
            ...initState("c1"),
            playerLane: 2,
            enemies: [mk(0, "broadcast", 1, 30_000, { hp: BROADCAST_P3_HP - 1 })],
        }
        const hp0 = s.barricadeHp
        for (let i = 0; i < BROADCAST_SHELL_PERIOD; i++) s = tick(s, NO_SPAWNS)
        expect(s.barricadeHp).toBeLessThanOrEqual(hp0 - BROADCAST_SHELL)
    })

    it("phase 1 (high HP) keeps today's behavior: rally jam only, no menders, no shelling", () => {
        let s = { ...initState("c1"), playerLane: 2, enemies: [mk(0, "broadcast", 1, 30_000)] }
        const hp0 = s.barricadeHp
        for (let i = 0; i < 200; i++) s = tick(s, NO_SPAWNS)
        expect(s.enemies.some((e) => e.archetype === "mender")).toBe(false)
        expect(s.barricadeHp).toBe(hp0)
    })
})
