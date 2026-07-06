import { describe, it, expect } from "vitest"
import { avatarHue, avatarLabel } from "./feedAvatar"

describe("feedAvatar", () => {
    it("labels with the two chars after the g1 prefix, uppercased", () => {
        expect(avatarLabel("g1abcdefghijklmnop")).toBe("AB")
        expect(avatarLabel("g1zooma000000000000")).toBe("ZO")
    })

    it("falls back to the first two chars for a non-g1 string", () => {
        expect(avatarLabel("xy")).toBe("XY")
        expect(avatarLabel("")).toBe("?")
    })

    it("derives a deterministic hue in [0, 360) from the address", () => {
        const h = avatarHue("g1abcdefghijklmnop")
        expect(h).toBe(avatarHue("g1abcdefghijklmnop")) // stable
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThan(360)
    })

    it("gives different addresses different hues (no single-bucket collapse)", () => {
        const a = avatarHue("g1aaaaaaaaaaaaaaaa")
        const b = avatarHue("g1bbbbbbbbbbbbbbbb")
        expect(a).not.toBe(b)
    })
})
