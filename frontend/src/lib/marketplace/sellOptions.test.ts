/**
 * sellOptions.test.ts — "Sell anything" routing map (marketplace-v2 Phase 4.2).
 */
import { describe, it, expect } from "vitest"
import { buildSellOptions } from "./sellOptions"

describe("buildSellOptions", () => {
    it("includes one network-prefixed option per live lane", () => {
        const opts = buildSellOptions("test13", { nft: true, service: true, token: true })
        expect(opts.map((o) => o.key)).toEqual(["nft", "service", "token"])
        expect(opts[0].to).toBe("/test13/nft/create")
        expect(opts[2].to).toBe("/test13/marketplace/tokens")
    })

    it("omits gated lanes (no coming-soon rows)", () => {
        const opts = buildSellOptions("test13", { nft: true, service: false, token: false })
        expect(opts.map((o) => o.key)).toEqual(["nft"])
    })

    it("returns [] when no lane is live", () => {
        expect(buildSellOptions("test13", { nft: false, service: false, token: false })).toEqual([])
    })
})
