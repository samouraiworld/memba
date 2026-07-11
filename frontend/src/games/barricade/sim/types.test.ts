import { describe, expect, it } from "vitest"
import { BARRICADE_MAX_HP, LANES, LANE_LENGTH, RUN_MAX_TICKS, SIM_VERSION, TICKS_PER_SECOND } from "./types"

describe("sim constants", () => {
    it("locks the deterministic tuning surface", () => {
        expect(TICKS_PER_SECOND).toBe(60)
        expect(LANES).toBe(3)
        expect(Number.isInteger(BARRICADE_MAX_HP + LANE_LENGTH + RUN_MAX_TICKS)).toBe(true)
        expect(SIM_VERSION).toBe(1)
    })
})
