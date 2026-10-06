import { describe, expect, it } from "vitest"
import { durationText, govReadError, valueText } from "./govView"

describe("govView", () => {
    it("words durations in their largest whole unit", () => {
        expect([86400, 259200, 604800, 3600, 7200, 5400].map(durationText)).toEqual(["1 day", "3 days", "7 days", "1 hour", "2 hours", "90 minutes"])
    })

    it("shows each kind of value as a voter reads it", () => {
        expect(valueText("ugnot", "1000000")).toBe("1 GNOT")
        expect(valueText("ugnot", "2500001")).toBe("2.500001 GNOT")
        expect(valueText("ugnot", "-1500000")).toBe("-1.5 GNOT")
        expect(valueText("bps", "250")).toBe("2.5% (250 bps)")
        expect(valueText("time", "0")).toBe("now (0)")
        expect(valueText("time", "4102444800")).toMatch(/unix 4102444800\)$/)
        expect(valueText("height", "42")).toBe("block 42")
        expect(valueText("yesno", "1")).toBe("Yes")
        expect(valueText("text", "")).toBe("(none)")
    })

    it("says so when the RPC answered for another chain", () => {
        expect(govReadError(new Error("RPC network does not match the selected chain"))).toMatch(/another chain/)
        expect(govReadError(new Error("x"))).toMatch(/network may be busy/)
    })
})
