import { describe, it, expect, beforeEach } from "vitest"
import { networkUrl, switchGnoNetwork } from "./networkSwitch"

describe("networkUrl", () => {
    it("swaps a leading /:network segment for the new one", () => {
        expect(networkUrl("topaz", "/test13/dashboard")).toBe("/topaz/dashboard")
        expect(networkUrl("topaz", "/test13/dao/samcrew")).toBe("/topaz/dao/samcrew")
    })

    it("prepends the network when the path carries no network segment", () => {
        expect(networkUrl("topaz", "/dashboard")).toBe("/topaz/dashboard")
    })

    it("keeps a trailing slash when only a network segment is present (existing behaviour)", () => {
        expect(networkUrl("topaz", "/test13")).toBe("/topaz/")
        expect(networkUrl("topaz", "/")).toBe("/topaz/")
    })
})

describe("switchGnoNetwork", () => {
    beforeEach(() => localStorage.clear())

    it("ignores an unknown network key — no persist, no navigation", () => {
        switchGnoNetwork("not-a-network")
        expect(localStorage.getItem("memba_network")).toBeNull()
    })
})
