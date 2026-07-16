/**
 * coords.ts — the sim ⇄ 3D-world coordinate bridge (Phase 0, PR-0b).
 *
 * Forward: place the integer sim (lane, pos) into the 3D world. Lanes run along
 * X (centered on origin); the milli-unit sim `pos` maps linearly onto depth Z,
 * with 0 = spawn (far) and LANE_LENGTH = barricade (near, Z=0).
 *
 * Inverse: turn a ground tap into an INTEGER (lane, dist) sim event. This is the
 * SAFETY-CRITICAL direction. `engine.applyEvent` silently no-ops any non-integer
 * or out-of-range `dist`/`lane` (engine.ts:270-271), so a float from the raycast
 * would make every 3D molotov a silent misfire that STILL certifies VERIFIED. So
 * `groundRaycastToLaneDist` emits a plain integer in exactly the 2D path's domain
 * (Barricade.tsx:268 — `Math.round(clamp01(...)·LANE_LENGTH)`) or an explicit
 * null "no-throw" on a degenerate ray — never a smuggled float.
 */
import { Raycaster, Vector2, Vector3, Plane, type Camera } from "three"
import { LANES, LANE_LENGTH } from "../../../sim/types"

export const LANE_SPACING = 2 // world units between lane centers
export const FIELD_DEPTH = 12 // world units, barricade (near, z=0) → spawn (far, z=-FIELD_DEPTH)
const X_MIN = -(LANES * LANE_SPACING) / 2 // left edge of lane 0 (= -3 for LANES=3)

/** World X of a lane's center (lanes centered on the origin). */
export function laneX(lane: number): number {
    return (lane - (LANES - 1) / 2) * LANE_SPACING
}

/** World Z of a sim pos: pos=0 → far (-FIELD_DEPTH), pos=LANE_LENGTH → near (0). */
export function posZ(pos: number): number {
    return (pos / LANE_LENGTH - 1) * FIELD_DEPTH
}

/** Ground-plane world position of an enemy (y=0). */
export function worldForEnemy(e: { lane: number; pos: number }): { x: number; z: number } {
    return { x: laneX(e.lane), z: posZ(e.pos) }
}

// Reused scratch — this is called per pointer event; no per-call allocation.
const GROUND = new Plane(new Vector3(0, 1, 0), 0)
const raycaster = new Raycaster()
const ndc = new Vector2()
const hit = new Vector3()

/**
 * Invert a pointer (NDC in [-1,1]²) + camera into an integer (lane, dist), or
 * null when the ray is degenerate (parallel / above the horizon / behind camera).
 * lane is clamped to [0, LANES); dist is Math.round(clamp01(depthFrac)·LANE_LENGTH)
 * in [0, LANE_LENGTH] — bit-identical in domain to the 2D throw path.
 */
export function groundRaycastToLaneDist(
    pointerNDC: { x: number; y: number },
    camera: Camera,
): { lane: number; dist: number } | null {
    if (!Number.isFinite(pointerNDC.x) || !Number.isFinite(pointerNDC.y)) return null
    ndc.set(pointerNDC.x, pointerNDC.y)
    raycaster.setFromCamera(ndc, camera)
    const point = raycaster.ray.intersectPlane(GROUND, hit)
    if (point === null || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null
    const lane = Math.min(LANES - 1, Math.max(0, Math.floor((point.x - X_MIN) / LANE_SPACING)))
    const frac = Math.max(0, Math.min(1, (point.z + FIELD_DEPTH) / FIELD_DEPTH))
    const dist = Math.round(frac * LANE_LENGTH)
    return { lane, dist }
}
