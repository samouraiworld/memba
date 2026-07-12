import { describe, expect, it } from "vitest"
import {
    applyEvent,
    initState,
    tick,
    ENEMY_CAP,
    KETTLE_PERIOD,
    KETTLE_LITTER,
    MARSHAL_UP,
    MARSHAL_REDUCT_PCT,
} from "./engine"
import { ARCHETYPES, buildWaves } from "./waves"
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
    speed: 0, // parked by default so combat math is isolated
    bornTick: 0,
    hasFlanked: false,
    ...over,
})

describe("marshal (windowed frontal shield)", () => {
    it("blunts frontal fire while the shield is up, takes full damage in the open window", () => {
        // bornTick 0 → shield up while (tick - 0) % MARSHAL_CYCLE < MARSHAL_UP.
        let up = { ...initState("b3"), enemies: [mk(0, "marshal", 0, 50_000)], playerLane: 0 }
        up = tick(up, NO_SPAWNS) // tick 1: (1 % cycle) < UP → shielded
        const shielded = ARCHETYPES.marshal.hp - Math.floor((2_500 * (100 - MARSHAL_REDUCT_PCT)) / 100)
        expect(up.enemies[0].hp).toBe(shielded)

        // Fast-forward a fixture into the open window (shield down).
        let open = {
            ...initState("b3"),
            tick: MARSHAL_UP, // next tick lands at MARSHAL_UP+1 … still in the window if UP+1 < CYCLE
            enemies: [mk(0, "marshal", 0, 50_000)],
            playerLane: 0,
        }
        open = tick(open, NO_SPAWNS)
        expect(open.enemies[0].hp).toBe(ARCHETYPES.marshal.hp - 2_500) // full frontal
    })

    it("molotov burst ignores the shield entirely (window-independent answer)", () => {
        let s = { ...initState("b3"), enemies: [mk(0, "marshal", 1, 50_000), DECOY] }
        s = applyEvent(s, { tick: 0, type: "throw", lane: 1, dist: 50_000 })
        for (let i = 0; i < 21; i++) s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.hp).toBe(ARCHETYPES.marshal.hp - 6_000 - 500)
    })
})

describe("kettle (swarm spawner + lane lock)", () => {
    it("deploys swarm children into its lane on its born-tick cadence, with sequential ids", () => {
        let s = { ...initState("b3"), enemies: [mk(0, "kettle", 1, 40_000)], nextEnemyId: 1 }
        for (let i = 0; i < KETTLE_PERIOD; i++) s = tick(s, NO_SPAWNS)
        const kids = s.enemies.filter((e) => e.archetype === "swarm")
        expect(kids.length).toBe(KETTLE_LITTER)
        expect(kids.map((k) => k.id)).toEqual(kids.map((_, i) => 1 + i)) // nextEnemyId order
        for (const k of kids) {
            expect(k.lane).toBe(1)
            expect(k.bornTick).toBe(KETTLE_PERIOD)
        }
    })

    it("refuses to mint past the global enemy cap (verifier cost bound)", () => {
        const crowd: Enemy[] = []
        for (let i = 0; i < ENEMY_CAP; i++) crowd.push(mk(100 + i, "drone", 2, 5_000, { hp: 9_999_999 }))
        let s = { ...initState("b3"), enemies: [mk(0, "kettle", 1, 40_000), ...crowd], nextEnemyId: 500 }
        for (let i = 0; i < KETTLE_PERIOD; i++) s = tick(s, NO_SPAWNS)
        expect(s.enemies.filter((e) => e.archetype === "swarm").length).toBe(0)
        expect(s.nextEnemyId).toBe(500) // nothing minted
    })

    it("locks its lane: moving INTO it is a no-op while the kettle lives, leaving is fine", () => {
        const s = { ...initState("b3"), playerLane: 0, enemies: [mk(0, "kettle", 1, 40_000)] }
        expect(applyEvent(s, { tick: 0, type: "move", lane: 1 }).playerLane).toBe(0) // blocked
        expect(applyEvent(s, { tick: 0, type: "move", lane: 2 }).playerLane).toBe(2) // elsewhere fine
        const inside = { ...s, playerLane: 1 }
        expect(applyEvent(inside, { tick: 0, type: "move", lane: 0 }).playerLane).toBe(0) // leaving allowed
    })

    it("killing the kettle unlocks the lane", () => {
        // The player parks ON the kettle's lane… no — entry is blocked, so park
        // the kettle IN the player's lane (it marched there), let auto-fire kill
        // it, then verify a previously-blocked entry from outside now works.
        let s = { ...initState("b3"), playerLane: 1, enemies: [mk(0, "kettle", 1, 40_000, { hp: 2_000 })] }
        s = tick(s, NO_SPAWNS) // auto-fire 2500 ≥ 2000 → dead this tick
        expect(s.enemies.some((e) => e.archetype === "kettle")).toBe(false)
        const outside = { ...s, playerLane: 0 }
        expect(applyEvent(outside, { tick: outside.tick, type: "move", lane: 1 }).playerLane).toBe(1)
    })

    it("a kettle arrives deploying — the litter cadence includes its own spawn tick", () => {
        // (tick − bornTick) % PERIOD passes at birth (0 % PERIOD === 0), and the
        // litter step runs after script spawns in the same tick: wave 9's kettle
        // shows up with an instant escort. Deliberate — pinned so a future edit
        // is a conscious replay-shape decision, not an accident.
        const script: WaveScript[] = [{ wave: 0, spawns: [{ atTick: 3, lane: 1, archetype: "kettle" }] }]
        let s = initState("b3")
        for (let i = 0; i < 3; i++) s = tick(s, script)
        expect(s.enemies.filter((e) => e.archetype === "kettle").length).toBe(1)
        expect(s.enemies.filter((e) => e.archetype === "swarm").length).toBe(KETTLE_LITTER)
        expect(s.enemies.filter((e) => e.archetype === "swarm").every((e) => e.bornTick === 3)).toBe(true)
    })
})

describe("dampener (water-cannon fire governor)", () => {
    it("douses fire fields in its lane after one burn, leaves other lanes alone", () => {
        let s = {
            ...initState("b3"),
            enemies: [mk(0, "dampener", 1, 30_000, { hp: 9_999_999 }), DECOY],
            hazards: [
                { id: 0, lane: 1, posLo: 0, posHi: 100_000, dmgPerTick: 500, expiresAtTick: 10_000 },
                { id: 1, lane: 0, posLo: 0, posHi: 100_000, dmgPerTick: 500, expiresAtTick: 10_000 },
            ],
        }
        const hp0 = s.enemies[0].hp
        s = tick(s, NO_SPAWNS) // burn applies this tick…
        expect(s.enemies.find((e) => e.id === 0)?.hp).toBe(hp0 - 500)
        expect(s.hazards.map((h) => h.id)).toEqual([1]) // …then the lane-1 field is doused
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.hp).toBe(hp0 - 500) // no further burn
        expect(s.hazards.map((h) => h.id)).toEqual([1]) // other lane untouched
    })

    it("a molotov still bursts a dampener — only the lingering fire is denied", () => {
        let s = { ...initState("b3"), enemies: [mk(0, "dampener", 1, 50_000)], playerLane: 2 }
        s = applyEvent(s, { tick: 0, type: "throw", lane: 1, dist: 50_000 })
        for (let i = 0; i < 21; i++) s = tick(s, NO_SPAWNS)
        expect(s.enemies.find((e) => e.id === 0)?.hp).toBe(ARCHETYPES.dampener.hp - 6_000 - 500) // burst + the one burn
    })

    it("fields persist again once the dampener dies", () => {
        let s = {
            ...initState("b3"),
            enemies: [DECOY],
            hazards: [{ id: 0, lane: 1, posLo: 0, posHi: 100_000, dmgPerTick: 500, expiresAtTick: 10_000 }],
        }
        s = tick(s, NO_SPAWNS)
        expect(s.hazards.length).toBe(1) // no dampener → the field lives
    })
})

describe("hand-placed mini-bosses in the arc", () => {
    it("wave 5 carries exactly one marshal, wave 9 exactly one kettle, on every seed", () => {
        const start = Date.UTC(2026, 6, 1)
        for (let d = 0; d < 30; d++) {
            const seed = `barricade-${new Date(start + d * 86_400_000).toISOString().slice(0, 10)}`
            const waves = buildWaves(seed)
            expect(waves[4].spawns.filter((sp) => sp.archetype === "marshal").length, seed).toBe(1)
            expect(waves[8].spawns.filter((sp) => sp.archetype === "kettle").length, seed).toBe(1)
            for (const w of waves) {
                if (w.wave !== 4) expect(w.spawns.some((sp) => sp.archetype === "marshal"), seed).toBe(false)
                if (w.wave !== 8) expect(w.spawns.some((sp) => sp.archetype === "kettle"), seed).toBe(false)
            }
        }
    })
})
