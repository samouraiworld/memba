import { describe, expect, it } from "vitest"
import { initState } from "../sim/engine"
import { ARCHETYPES } from "../sim/waves"
import type { ArchetypeId, Enemy, SimState } from "../sim/types"
import { interpPositions } from "./interp"

function enemy(id: number, archetype: ArchetypeId, lane: number, pos: number): Enemy {
    return { id, archetype, lane, pos, hp: ARCHETYPES[archetype].hp, speed: ARCHETYPES[archetype].speed, bornTick: 0, hasFlanked: false }
}

function stateWith(enemies: Enemy[]): SimState {
    return { ...initState("interp-test"), enemies }
}

describe("interpPositions", () => {
    it("lerps a matched enemy's position by alpha", () => {
        const prev = stateWith([enemy(1, "drone", 0, 100)])
        const cur = stateWith([enemy(1, "drone", 0, 200)])
        expect(interpPositions(prev, cur, 0).get(1)).toBe(100)
        expect(interpPositions(prev, cur, 0.5).get(1)).toBe(150)
        expect(interpPositions(prev, cur, 1).get(1)).toBe(200)
    })

    it("clamps alpha to [0,1]", () => {
        const prev = stateWith([enemy(1, "drone", 0, 100)])
        const cur = stateWith([enemy(1, "drone", 0, 200)])
        expect(interpPositions(prev, cur, -3).get(1)).toBe(100) // below → prev
        expect(interpPositions(prev, cur, 2).get(1)).toBe(200) // above → cur
    })

    it("renders a just-spawned enemy (absent in prev) at its current position", () => {
        const prev = stateWith([enemy(1, "drone", 0, 100)])
        const cur = stateWith([enemy(1, "drone", 0, 200), enemy(2, "walker", 1, 300)])
        const m = interpPositions(prev, cur, 0.5)
        expect(m.get(2)).toBe(300) // no prev sample → snap to current
        expect(m.get(1)).toBe(150)
    })

    it("omits an enemy that died this tick (present in prev, gone in cur)", () => {
        const prev = stateWith([enemy(1, "drone", 0, 100), enemy(2, "walker", 1, 400)])
        const cur = stateWith([enemy(1, "drone", 0, 200)])
        const m = interpPositions(prev, cur, 0.5)
        expect(m.has(2)).toBe(false)
        expect(m.size).toBe(1) // exactly the live-in-cur set
    })

    it("returns an empty map when the field is clear", () => {
        expect(interpPositions(stateWith([]), stateWith([]), 0.5).size).toBe(0)
    })

    it("never mutates its inputs (render-only, cannot perturb the sim)", () => {
        const prev = stateWith([enemy(1, "drone", 0, 100)])
        const cur = stateWith([enemy(1, "drone", 0, 200)])
        const beforePrev = JSON.stringify(prev)
        const beforeCur = JSON.stringify(cur)
        interpPositions(prev, cur, 0.5)
        expect(JSON.stringify(prev)).toBe(beforePrev)
        expect(JSON.stringify(cur)).toBe(beforeCur)
    })
})
