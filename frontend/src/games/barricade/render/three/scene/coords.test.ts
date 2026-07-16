import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { PerspectiveCamera, Vector3 } from "three"
import { LANES, LANE_LENGTH } from "../../../sim/types"
import { laneX, posZ, worldForEnemy, groundRaycastToLaneDist, FIELD_DEPTH } from "./coords"

// A representative down-field camera (mild tilt, framed for portrait 3:5) that
// images the ground region the lanes occupy. NOT the final PR-0c camera — just a
// concrete camera so the raycast output-domain assertions are meaningful.
function makeCamera(): PerspectiveCamera {
    const cam = new PerspectiveCamera(50, 390 / 650, 0.1, 100)
    cam.position.set(0, 7, 5)
    cam.lookAt(new Vector3(0, 0, -5))
    cam.updateMatrixWorld(true)
    return cam
}

describe("coords world mapping", () => {
    it("places lanes symmetrically along X", () => {
        expect(laneX(0)).toBeCloseTo(-2)
        expect(laneX(1)).toBeCloseTo(0)
        expect(laneX(2)).toBeCloseTo(2)
    })
    it("maps sim pos onto depth: spawn(0)=far, barricade(LANE_LENGTH)=near(0)", () => {
        expect(posZ(0)).toBeCloseTo(-FIELD_DEPTH)
        expect(posZ(LANE_LENGTH)).toBeCloseTo(0)
        expect(posZ(LANE_LENGTH / 2)).toBeCloseTo(-FIELD_DEPTH / 2)
    })
    it("worldForEnemy composes laneX + posZ", () => {
        expect(worldForEnemy({ lane: 2, pos: LANE_LENGTH })).toEqual({ x: laneX(2), z: posZ(LANE_LENGTH) })
    })
})

describe("groundRaycastToLaneDist — the integer-domain safety contract (R3)", () => {
    const cam = makeCamera()

    // THE test that would have caught R3: a float/out-of-range dist is silently
    // no-op'd by engine.applyEvent, so a leaked non-integer never throws — it just
    // misfires while still certifying VERIFIED. This asserts the output can only
    // ever be a null (no-throw) or an integer (lane,dist) inside the sim domain.
    it("OUTPUT DOMAIN: for ANY pointer across the viewport, returns null or INTEGER (lane,dist) in range", () => {
        fc.assert(
            fc.property(
                fc.double({ min: -1, max: 1, noNaN: true }),
                fc.double({ min: -1, max: 1, noNaN: true }),
                (nx, ny) => {
                    const r = groundRaycastToLaneDist({ x: nx, y: ny }, cam)
                    if (r === null) return true
                    return (
                        Number.isInteger(r.lane) && r.lane >= 0 && r.lane < LANES &&
                        Number.isInteger(r.dist) && r.dist >= 0 && r.dist <= LANE_LENGTH
                    )
                },
            ),
            { numRuns: 500 },
        )
    })

    it("a tap at the bottom-center of the frame hits the near ground and fires (non-null, middle lane)", () => {
        const r = groundRaycastToLaneDist({ x: 0, y: -0.6 }, cam)
        expect(r).not.toBeNull()
        expect(r!.lane).toBe(1)
        expect(Number.isInteger(r!.dist)).toBe(true)
    })

    it("returns null on a degenerate ray (camera looking away from the ground = explicit no-throw)", () => {
        const up = new PerspectiveCamera(50, 390 / 650, 0.1, 100)
        up.position.set(0, 1, 0)
        up.lookAt(new Vector3(0, 10, -10)) // looking UP → the center ray never meets y=0 ahead
        up.updateMatrixWorld(true)
        expect(groundRaycastToLaneDist({ x: 0, y: 0 }, up)).toBeNull()
    })

    it("rejects a non-finite pointer as no-throw", () => {
        expect(groundRaycastToLaneDist({ x: NaN, y: 0 }, cam)).toBeNull()
    })
})
