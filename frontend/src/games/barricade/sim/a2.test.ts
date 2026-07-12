import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "./engine"
import { hashState, runReplay } from "./replay"
import { ARCHETYPES } from "./waves"
import type { ArchetypeId, Enemy, SimEvent } from "./types"
import type { WaveScript } from "./waves"

const NO_SPAWNS: WaveScript[] = [{ wave: 0, spawns: [] }]
const DECOY: Enemy = { id: 99, archetype: "drone", lane: 2, pos: 10_000, hp: 9_999_999, speed: 0 }
const enemy = (id: number, archetype: ArchetypeId, lane: number, pos: number, hp: number, speed = 0): Enemy => ({
    id,
    archetype,
    lane,
    pos,
    hp,
    speed,
})

describe("shove", () => {
    it("knocks the front machine of a lane back and goes on cooldown", () => {
        let s: ReturnType<typeof initState> = {
            ...initState("a2"),
            enemies: [enemy(0, "drone", 1, 40_000, 3_000), enemy(1, "drone", 1, 70_000, 3_000)],
        }
        s = applyEvent(s, { tick: 0, type: "shove", lane: 1 })
        expect(s.enemies.find((e) => e.id === 1)?.pos).toBe(70_000 - 15_000) // front (higher pos) pushed back
        expect(s.enemies.find((e) => e.id === 0)?.pos).toBe(40_000) // the one behind untouched
        expect(s.shoveReadyAt).toBe(180)
    })

    it("clamps knockback at the spawn end", () => {
        let s: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "drone", 0, 5_000, 3_000)] }
        s = applyEvent(s, { tick: 0, type: "shove", lane: 0 })
        expect(s.enemies[0].pos).toBe(0)
    })

    it("no-ops on cooldown / during choice / bad lane / empty lane (no cooldown spent on a whiff)", () => {
        const base: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "drone", 0, 50_000, 3_000)] }
        expect(applyEvent({ ...base, shoveReadyAt: 5 }, { tick: 0, type: "shove", lane: 0 }).enemies[0].pos).toBe(50_000)
        expect(applyEvent({ ...base, phase: "choice" as const }, { tick: 0, type: "shove", lane: 0 }).enemies[0].pos).toBe(
            50_000,
        )
        expect(applyEvent(base, { tick: 0, type: "shove", lane: 9 }).enemies[0].pos).toBe(50_000)
        expect(applyEvent(base, { tick: 0, type: "shove", lane: 2 }).shoveReadyAt).toBe(0) // whiff → no CD
    })
})

describe("testudo shield + swarm", () => {
    it("blunts frontal fire on a testudo, but molotov burst + burn ignore the shield", () => {
        // Frontal auto-fire 2500 → 60% = 1500 on the shield.
        let front: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "testudo", 0, 50_000, 14_000), DECOY] }
        front = tick(front, NO_SPAWNS)
        expect(front.enemies.find((e) => e.id === 0)?.hp).toBe(14_000 - 1_500)

        // Molotov: full burst (6000) + a burn (500) at impact — no reduction.
        let molo: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "testudo", 1, 50_000, 14_000), DECOY] }
        molo = applyEvent(molo, { tick: 0, type: "throw", lane: 1, dist: 50_000 })
        for (let i = 0; i < 21; i++) molo = tick(molo, NO_SPAWNS)
        expect(molo.enemies.find((e) => e.id === 0)?.hp).toBe(14_000 - 6_000 - 500)
    })

    it("a swarm unit dies to a single auto-fire tick (fragile by design)", () => {
        expect(ARCHETYPES.swarm.hp).toBeLessThan(2_500) // below PLAYER_DPS_PER_TICK
        let s: ReturnType<typeof initState> = {
            ...initState("a2"),
            enemies: [enemy(0, "swarm", 0, 50_000, ARCHETYPES.swarm.hp), DECOY],
        }
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.some((e) => e.id === 0)).toBe(false)
    })

    it("shoveReadyAt is hashed; a landed shove changes the run; the replay path stays deterministic", () => {
        const base = initState("a2")
        expect(hashState({ ...base, shoveReadyAt: 42 })).not.toBe(hashState(base))

        // Controlled divergence (no reliance on wave RNG): a high-HP machine off
        // the player's lane so ONLY the shove moves it — 15k back vs un-shoved.
        const start: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "drone", 1, 90_000, 9_999_999, 700)] }
        let shoved = applyEvent(start, { tick: 0, type: "shove", lane: 1 })
        let plain = start
        for (let i = 0; i < 3; i++) {
            shoved = tick(shoved, NO_SPAWNS)
            plain = tick(plain, NO_SPAWNS)
        }
        expect(hashState(shoved)).not.toBe(hashState(plain)) // the shove mattered

        // The cooldown is GLOBAL (one scalar, like the molotov's) — a shove in any
        // lane blocks all lanes for SHOVE_CD ticks. Replay stays deterministic.
        const seed = "barricade-2026-07-12"
        const events: SimEvent[] = [
            { tick: 40, type: "shove", lane: 0 },
            { tick: 80, type: "shove", lane: 1 },
        ]
        expect(runReplay(seed, events).stateHash).toBe(runReplay(seed, events).stateHash)
        expect(runReplay(seed, events).simVersion).toBe(2)
    })

    it("shove and frontal fire break a same-pos tie deterministically (front = array / lowest id)", () => {
        let s: ReturnType<typeof initState> = {
            ...initState("a2"),
            enemies: [enemy(3, "drone", 0, 60_000, 3_000), enemy(7, "drone", 0, 60_000, 3_000)],
        }
        s = applyEvent(s, { tick: 0, type: "shove", lane: 0 })
        expect(s.enemies.find((e) => e.id === 3)?.pos).toBe(45_000) // lower id (array order) is the front
        expect(s.enemies.find((e) => e.id === 7)?.pos).toBe(60_000)
    })

    it("frontal fire still kills a testudo through the shield and credits its scrap once", () => {
        let s: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "testudo", 0, 50_000, 3_000), DECOY] }
        s = tick(s, NO_SPAWNS) // shielded 1500 → hp 1500
        expect(s.enemies.find((e) => e.id === 0)?.hp).toBe(1_500)
        s = tick(s, NO_SPAWNS) // 1500 → dead
        expect(s.enemies.some((e) => e.id === 0)).toBe(false)
        expect(s.scrap).toBe(ARCHETYPES.testudo.scrap)
    })

    it("shove works in the boss phase (only choice / terminal block it)", () => {
        let s: ReturnType<typeof initState> = {
            ...initState("a2"),
            phase: "boss" as const,
            enemies: [enemy(0, "drone", 0, 60_000, 3_000)],
        }
        s = applyEvent(s, { tick: 0, type: "shove", lane: 0 })
        expect(s.enemies[0].pos).toBe(45_000)
    })
})
