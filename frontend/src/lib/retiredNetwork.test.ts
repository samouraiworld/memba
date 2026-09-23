import { describe, it, expect } from "vitest"
import { retiredNetworkTarget, retiredNetworkMessage } from "./retiredNetwork"

const loc = (pathname: string, search = "", hash = "") => ({ pathname, search, hash })

describe("retiredNetworkTarget", () => {
    it("swaps only the network prefix and keeps the rest of the URL", () => {
        expect(retiredNetworkTarget(loc("/pearl/dao/gno.land~r~gov~dao", "?tab=votes", "#top"), "pearl", "mainnet"))
            .toBe("/mainnet/dao/gno.land~r~gov~dao?tab=votes#top")
    })

    it("maps the bare prefix to the successor home", () => {
        expect(retiredNetworkTarget(loc("/pearl"), "pearl", "mainnet")).toBe("/mainnet/")
        expect(retiredNetworkTarget(loc("/pearl/"), "pearl", "mainnet")).toBe("/mainnet/")
    })

    it("does not treat a longer first segment as the prefix", () => {
        // `/pearly/x` is not under `/pearl` — no partial-prefix slicing.
        expect(retiredNetworkTarget(loc("/pearly/x"), "pearl", "mainnet")).toBe("/mainnet/pearly/x")
    })
})

describe("retiredNetworkMessage", () => {
    it("names the retired testnet and the mainnet it moved to", () => {
        expect(retiredNetworkMessage("pearl")).toBe("The Pearl testnet has been retired — you're now on gno.land mainnet.")
    })

    it("is null for a network that is not retired", () => {
        expect(retiredNetworkMessage("mainnet")).toBeNull()
        expect(retiredNetworkMessage("test13")).toBeNull()
        expect(retiredNetworkMessage("no-such-network")).toBeNull()
    })
})
