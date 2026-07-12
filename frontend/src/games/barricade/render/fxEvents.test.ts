import { describe, expect, it } from "vitest"
import { initState } from "../sim/engine"
import { BARRICADE_MAX_HP, LANE_LENGTH, RALLY_FULL, type Enemy, type SimState } from "../sim/types"
import { deriveFxEvents } from "./fxEvents"

function mk(overrides: Partial<SimState>): SimState {
    return { ...initState("fx-test"), ...overrides }
}

function en(id: number, archetype: Enemy["archetype"], lane: number, pos: number, speed = 100, hp = 1000): Enemy {
    return { id, archetype, lane, pos, hp, speed }
}

describe("deriveFxEvents", () => {
    it("emits a kill for an enemy that vanished away from the line", () => {
        const prev = mk({ enemies: [en(1, "siege", 2, 40_000, 250)] })
        const next = mk({ enemies: [] })
        const evs = deriveFxEvents(prev, next)
        expect(evs).toEqual([{ kind: "kill", lane: 2, posFrac: 0.4, weight: 3, archetype: "siege" }])
    })

    it("does NOT emit a kill for an enemy that reached the barricade (boundary)", () => {
        // pos + speed >= LANE_LENGTH → treated as reached, not killed
        const prev = mk({ enemies: [en(1, "drone", 0, LANE_LENGTH - 50, 700)], barricadeHp: BARRICADE_MAX_HP })
        const next = mk({ enemies: [], barricadeHp: BARRICADE_MAX_HP - 4_000 })
        const evs = deriveFxEvents(prev, next)
        expect(evs.some((e) => e.kind === "kill")).toBe(false)
        expect(evs).toContainEqual({ kind: "barricadeHit", damageFrac: 4_000 / BARRICADE_MAX_HP })
    })

    it("emits a kill for a front enemy killed in combat at the line (no barricade damage)", () => {
        // Same boundary position, but the barricade took NO damage this frame, so
        // it died in combat and must still pop — previously it emitted nothing.
        const prev = mk({ enemies: [en(1, "drone", 0, LANE_LENGTH - 50, 700)], barricadeHp: BARRICADE_MAX_HP })
        const next = mk({ enemies: [], barricadeHp: BARRICADE_MAX_HP })
        const posFrac = Math.min(1, (LANE_LENGTH - 50) / LANE_LENGTH)
        expect(deriveFxEvents(prev, next)).toContainEqual({ kind: "kill", lane: 0, posFrac, weight: 1, archetype: "drone" })
    })

    it("emits barricadeHit with the damage fraction", () => {
        const prev = mk({ barricadeHp: BARRICADE_MAX_HP })
        const next = mk({ barricadeHp: BARRICADE_MAX_HP - 9_000 })
        expect(deriveFxEvents(prev, next)).toContainEqual({ kind: "barricadeHit", damageFrac: 9_000 / BARRICADE_MAX_HP })
    })

    it("emits rally when the meter snaps from full to zero", () => {
        const prev = mk({ rallyMeter: RALLY_FULL })
        const next = mk({ rallyMeter: 0 })
        expect(deriveFxEvents(prev, next)).toContainEqual({ kind: "rally" })
    })

    it("emits rallyReady when the meter crosses up to full", () => {
        const prev = mk({ rallyMeter: RALLY_FULL - 10 })
        const next = mk({ rallyMeter: RALLY_FULL })
        expect(deriveFxEvents(prev, next)).toContainEqual({ kind: "rallyReady" })
    })

    it("emits move on a lane change", () => {
        expect(deriveFxEvents(mk({ playerLane: 0 }), mk({ playerLane: 2 }))).toContainEqual({ kind: "move", lane: 2 })
    })

    it("emits phase on a phase transition", () => {
        expect(deriveFxEvents(mk({ phase: "wave" }), mk({ phase: "choice" }))).toContainEqual({ kind: "phase", phase: "choice" })
    })

    it("emits bossSpawn for a new broadcast enemy", () => {
        const prev = mk({ enemies: [] })
        const next = mk({ enemies: [en(7, "broadcast", 1, 0, 120, 90_000)] })
        expect(deriveFxEvents(prev, next)).toContainEqual({ kind: "bossSpawn", lane: 1 })
    })

    it("emits stun when the player is netted", () => {
        const prev = mk({ tick: 100, stunnedUntil: 0, playerLane: 1 })
        const next = mk({ tick: 100, stunnedUntil: 145, playerLane: 1 })
        expect(deriveFxEvents(prev, next)).toContainEqual({ kind: "stun", lane: 1 })
    })

    it("emits deploy for a turret and for arming the crowd", () => {
        const turret = deriveFxEvents(mk({ turrets: [0, 0, 0] }), mk({ turrets: [900, 0, 0] }))
        expect(turret).toContainEqual({ kind: "deploy", lane: 0, deploy: "turret" })
        const arm = deriveFxEvents(mk({ armed: 0, playerLane: 2 }), mk({ armed: 600, playerLane: 2 }))
        expect(arm).toContainEqual({ kind: "deploy", lane: 2, deploy: "arm" })
    })

    it("is pure — it never mutates its inputs", () => {
        const prev = mk({ enemies: [en(1, "drone", 0, 10_000, 700)], barricadeHp: BARRICADE_MAX_HP, rallyMeter: RALLY_FULL })
        const next = mk({ enemies: [], barricadeHp: BARRICADE_MAX_HP - 1_000, rallyMeter: 0 })
        const prevSnap = JSON.stringify(prev)
        const nextSnap = JSON.stringify(next)
        deriveFxEvents(prev, next)
        expect(JSON.stringify(prev)).toBe(prevSnap)
        expect(JSON.stringify(next)).toBe(nextSnap)
    })
})
