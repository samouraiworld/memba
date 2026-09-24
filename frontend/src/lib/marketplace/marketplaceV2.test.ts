/**
 * The v2 lanes (whose Services lane is the seed catalogue with placeholder
 * sellers) run only where the flag is on AND the network is a test network:
 * never on gno.land mainnet, whatever VITE_ENABLE_MARKETPLACE_V2 says.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const flag = vi.hoisted(() => ({ v2: true }))
vi.mock("../config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../config")>()),
    isMarketplaceV2Enabled: () => flag.v2,
}))

import { isMarketplaceV2Active } from "./marketplaceV2"
import { NETWORKS } from "../config"

beforeEach(() => { flag.v2 = true })

describe("isMarketplaceV2Active", () => {
    it("is off on mainnet even with the flag on", () => {
        expect(isMarketplaceV2Active("mainnet")).toBe(false)
    })

    it("is off on every network serving gnoland-1, and on any network not marked as a testnet", () => {
        const production = Object.entries(NETWORKS).filter(([, n]) => n.chainId === "gnoland-1").map(([k]) => k)
        expect(production.length).toBeGreaterThan(0)
        for (const key of production) expect(isMarketplaceV2Active(key)).toBe(false)
        expect(isMarketplaceV2Active("no-such-network")).toBe(false)
    })

    it("follows the flag on test networks", () => {
        expect(isMarketplaceV2Active("test13")).toBe(true)
        flag.v2 = false
        expect(isMarketplaceV2Active("test13")).toBe(false)
    })
})
