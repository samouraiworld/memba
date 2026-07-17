import { describe, expect, it } from "vitest"
import { initState } from "../../../sim/engine"
import { ARCHETYPES } from "../../../sim/waves"
import type { ArchetypeId, Enemy, SimState } from "../../../sim/types"
import type { SimSnapshot } from "../bridge/useSimSnapshots"
import { enemyPlacements, MAX_SLOTS } from "./placements"
import { laneX, posZ } from "./coords"

function mkEnemy(id: number, lane: number, pos: number, archetype: ArchetypeId = "walker"): Enemy {
    return { id, archetype, lane, pos, hp: ARCHETYPES[archetype].hp, speed: ARCHETYPES[archetype].speed, bornTick: 0, hasFlanked: false }
}
const withEnemies = (enemies: Enemy[]): SimState => ({ ...initState("3d-test"), enemies })

describe("enemyPlacements (sim→3D projection)", () => {
    it("returns [] before anything is published", () => {
        expect(enemyPlacements({ prev: null, next: null, alpha: 0 })).toEqual([])
    })

    it("maps each enemy to its world position (x=laneX, z=posZ) with no prev", () => {
        const next = withEnemies([mkEnemy(1, 0, 30_000), mkEnemy(2, 2, 90_000)])
        const out = enemyPlacements({ prev: null, next, alpha: 0.5 })
        expect(out).toHaveLength(2)
        expect(out[0]).toMatchObject({ id: 1, x: laneX(0), z: posZ(30_000) })
        expect(out[1]).toMatchObject({ id: 2, x: laneX(2), z: posZ(90_000) })
    })

    it("interpolates depth between prev and next by alpha (parity with the 2D path)", () => {
        const prev = withEnemies([mkEnemy(7, 1, 20_000)])
        const next = withEnemies([mkEnemy(7, 1, 40_000)])
        expect(enemyPlacements({ prev, next, alpha: 0 })[0].z).toBeCloseTo(posZ(20_000), 6)
        expect(enemyPlacements({ prev, next, alpha: 0.5 })[0].z).toBeCloseTo(posZ(30_000), 6)
        expect(enemyPlacements({ prev, next, alpha: 1 })[0].z).toBeCloseTo(posZ(40_000), 6)
    })

    it("a freshly-spawned enemy (absent from prev) snaps to its own pos", () => {
        const prev = withEnemies([])
        const next = withEnemies([mkEnemy(9, 1, 12_345)])
        expect(enemyPlacements({ prev, next, alpha: 0.5 })[0].z).toBeCloseTo(posZ(12_345), 6)
    })

    it("caps at MAX_SLOTS and never mutates the snapshot", () => {
        const next = withEnemies(Array.from({ length: 60 }, (_, i) => mkEnemy(i, i % 3, 10_000 + i)))
        const snap: SimSnapshot = { prev: null, next, alpha: 0 }
        const before = JSON.stringify(next)
        expect(enemyPlacements(snap).length).toBe(MAX_SLOTS)
        expect(JSON.stringify(next)).toBe(before)
    })
})
