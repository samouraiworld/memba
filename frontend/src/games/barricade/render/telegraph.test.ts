import { describe, expect, it } from "vitest"
import { LANE_LENGTH } from "../sim/types"
import { laneThreats, TELEGRAPH_FRAC } from "./telegraph"

const P = (frac: number) => Math.round(frac * LANE_LENGTH)

describe("laneThreats", () => {
    it("warns only for a lane whose front unit passed the threshold", () => {
        const t = laneThreats([{ lane: 0, pos: P(0.5) }, { lane: 1, pos: P(0.9) }])
        expect(t.map((x) => x.lane)).toEqual([1])
    })

    it("picks the front (nearest-barricade) unit per lane", () => {
        const t = laneThreats([{ lane: 2, pos: P(0.8) }, { lane: 2, pos: P(0.95) }, { lane: 2, pos: P(0.3) }])
        expect(t).toHaveLength(1)
        expect(t[0].frac).toBeCloseTo(0.95, 5)
    })

    it("ramps intensity from 0 at the threshold to 1 at the barricade", () => {
        expect(laneThreats([{ lane: 0, pos: P(TELEGRAPH_FRAC) }])[0].intensity).toBeCloseTo(0, 5)
        expect(laneThreats([{ lane: 0, pos: P(1) }])[0].intensity).toBeCloseTo(1, 5)
        const mid = laneThreats([{ lane: 0, pos: P((TELEGRAPH_FRAC + 1) / 2) }])[0].intensity
        expect(mid).toBeGreaterThan(0.4)
        expect(mid).toBeLessThan(0.6)
    })

    it("returns threats sorted by lane", () => {
        const t = laneThreats([{ lane: 2, pos: P(0.99) }, { lane: 0, pos: P(0.8) }])
        expect(t.map((x) => x.lane)).toEqual([0, 2])
    })

    it("returns nothing for an empty field or all-far units", () => {
        expect(laneThreats([])).toEqual([])
        expect(laneThreats([{ lane: 0, pos: P(0.1) }, { lane: 1, pos: P(0.7) }])).toEqual([])
    })

    it("does not mutate its input", () => {
        const units = [{ lane: 0, pos: P(0.9) }]
        const before = JSON.stringify(units)
        laneThreats(units)
        expect(JSON.stringify(units)).toBe(before)
    })
})
