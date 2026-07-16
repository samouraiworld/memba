import { describe, it, expect } from "vitest"
import { decideRenderer, parseOverride } from "./caps"

// PR-0b: the renderer switch is a PURE decision (no three, no live DOM) so it is
// exhaustively unit-testable. DOM reads (URL/localStorage/WebGL2 probe) are thin
// wrappers around these; the wrappers are exercised in jsdom below.

describe("decideRenderer", () => {
    const base = { flagEnabled: false, override: null as "on" | "off" | null, has3D: true, liteMode: false }

    it("defaults to 2D when the flag is off and there is no override", () => {
        expect(decideRenderer({ ...base })).toBe("2d")
    })
    it("uses 3D when the flag is on (WebGL2 present, not lite)", () => {
        expect(decideRenderer({ ...base, flagEnabled: true })).toBe("3d")
    })
    it("stays 2D without WebGL2 even if the flag is on (hard gate)", () => {
        expect(decideRenderer({ ...base, flagEnabled: true, has3D: false })).toBe("2d")
    })
    it("stays 2D in lite mode when only the flag opts in", () => {
        expect(decideRenderer({ ...base, flagEnabled: true, liteMode: true })).toBe("2d")
    })
    it("override 'on' forces 3D even with the flag off AND lite mode on (deliberate opt-in)", () => {
        expect(decideRenderer({ ...base, override: "on", liteMode: true })).toBe("3d")
    })
    it("override 'on' still cannot force 3D without WebGL2 (hard gate wins)", () => {
        expect(decideRenderer({ ...base, override: "on", has3D: false })).toBe("2d")
    })
    it("override 'off' forces 2D even with the flag on (deliberate opt-out)", () => {
        expect(decideRenderer({ ...base, flagEnabled: true, override: "off" })).toBe("2d")
    })
})

describe("parseOverride", () => {
    it("reads ?r3d=1 as on and ?r3d=0 as off", () => {
        expect(parseOverride("?r3d=1", null)).toBe("on")
        expect(parseOverride("?r3d=0", null)).toBe("off")
    })
    it("falls back to localStorage when the query param is absent", () => {
        expect(parseOverride("", "1")).toBe("on")
        expect(parseOverride("", "0")).toBe("off")
    })
    it("lets the query param win over localStorage", () => {
        expect(parseOverride("?r3d=0", "1")).toBe("off")
    })
    it("returns null when nothing opts in or out", () => {
        expect(parseOverride("", null)).toBe(null)
        expect(parseOverride("?foo=1", "bogus")).toBe(null)
    })
})
