/**
 * placements.ts — the pure sim→3D placement projection (Phase 0, PR-0c).
 *
 * Split out of the R3F component so the placement math (interpolation + world
 * mapping) is unit-testable HEADLESSLY — no GL context, no fiber import — and so the
 * live EnemyField loop and its tests share ONE implementation. Reuses the exact 2D
 * `interpPositions`, so a unit sits at the identical sub-tick pos in 2D and 3D.
 */
import { ARCHETYPES } from "../../../sim/waves"
import type { ArchetypeId } from "../../../sim/types"
import { interpPositions } from "../../interp"
import type { SimSnapshot } from "../bridge/useSimSnapshots"
import { laneX, posZ } from "./coords"

/** Hard cap on concurrent enemy meshes (waves never exceed this). */
export const MAX_SLOTS = 48

export interface RenderPlacement {
    id: number
    archetype: ArchetypeId
    x: number
    z: number
    hpFrac: number
}

/** Interpolated world placements for the live enemies, capped at MAX_SLOTS. Pure. */
export function enemyPlacements(snap: SimSnapshot): RenderPlacement[] {
    const next = snap.next
    if (!next) return []
    const interp = snap.prev ? interpPositions(snap.prev, next, snap.alpha) : null
    return next.enemies.slice(0, MAX_SLOTS).map((e) => {
        const a = ARCHETYPES[e.archetype]
        const pos = interp?.get(e.id) ?? e.pos
        return { id: e.id, archetype: e.archetype, x: laneX(e.lane), z: posZ(pos), hpFrac: Math.max(0.55, e.hp / a.hp) }
    })
}
