// C2 draft — sim/panopticon.test.ts (the overtime apex: cycling tool-denial)
import { describe, expect, it } from "vitest"
import { applyEvent, initState, MARSHAL_REDUCT_PCT, panopticonMode, tick } from "./engine"
import { ARCHETYPES, overtimeWave } from "./waves"
import { PANOPTICON_EVERY, PANOPTICON_PHASE, type Enemy } from "./types"
import type { WaveScript } from "./waves"

const NO_SPAWNS: WaveScript[] = [{ wave: 0, spawns: [] }]
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

describe("panopticon (the siege apex)", () => {
    it("appears in every PANOPTICON_EVERY-th overtime round, and only there", () => {
        for (let round = 1; round <= PANOPTICON_EVERY * 2; round++) {
            const w = overtimeWave("barricade-2026-07-12", round)
            const has = w.spawns.some((sp) => sp.archetype === "panopticon")
            expect(has, `round ${round}`).toBe(round % PANOPTICON_EVERY === 0)
        }
    })

    it("cycles its four denial modes on a telegraphed clock", () => {
        const p = mk(0, "panopticon", 1, 30_000)
        expect(panopticonMode(p, 1)).toBe(0) // shield
        expect(panopticonMode(p, PANOPTICON_PHASE)).toBe(1) // douse
        expect(panopticonMode(p, PANOPTICON_PHASE * 2)).toBe(2) // jam
        expect(panopticonMode(p, PANOPTICON_PHASE * 3)).toBe(3) // lock
        expect(panopticonMode(p, PANOPTICON_PHASE * 4)).toBe(0) // …and around again
    })

    it("mode 0: frontal fire is blunted like a raised pavise; molotov ignores it", () => {
        let s = { ...initState("c2"), playerLane: 1, enemies: [mk(0, "panopticon", 1, 50_000)] }
        s = tick(s, NO_SPAWNS) // tick 1 → mode 0
        const blunted = ARCHETYPES.panopticon.hp - Math.floor((2_500 * (100 - MARSHAL_REDUCT_PCT)) / 100)
        expect(s.enemies[0].hp).toBe(blunted)
    })

    it("mode 1: its lane is doused — a fire field there flashes once and dies", () => {
        let s = {
            ...initState("c2"),
            playerLane: 2,
            enemies: [mk(0, "panopticon", 1, 30_000, { bornTick: -PANOPTICON_PHASE })], // already in mode 1
            hazards: [{ id: 0, lane: 1, posLo: 0, posHi: 100_000, dmgPerTick: 500, expiresAtTick: 10_000 }],
        }
        s = tick(s, NO_SPAWNS)
        expect(s.hazards).toHaveLength(0)
    })

    it("mode 2: rally fill freezes and its lane's turret holds", () => {
        let s = {
            ...initState("c2"),
            playerLane: 0,
            turrets: [0, 900, 0],
            enemies: [
                mk(0, "panopticon", 1, 30_000, { bornTick: -PANOPTICON_PHASE * 2 }), // mode 2
                mk(1, "drone", 0, 50_000, { hp: 1_000 }),
                mk(2, "drone", 1, 50_000, { hp: 1_000 }),
            ],
        }
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.some((e) => e.id === 1)).toBe(false) // player still kills
        expect(s.rallyMeter).toBe(0) // …but the meter is jammed
        expect(s.enemies.some((e) => e.id === 2)).toBe(true) // lane-1 turret held
        expect(s.turrets[1]).toBe(900) // timer paused, not burned
    })

    it("mode 3: its street is kettled — entry blocked, leaving allowed", () => {
        const s = {
            ...initState("c2"),
            playerLane: 0,
            enemies: [mk(0, "panopticon", 1, 30_000, { bornTick: -PANOPTICON_PHASE * 3 })], // mode 3
        }
        expect(applyEvent(s, { tick: 0, type: "move", lane: 1 }).playerLane).toBe(0)
        expect(applyEvent({ ...s, playerLane: 1 }, { tick: 0, type: "move", lane: 2 }).playerLane).toBe(2)
    })
})
