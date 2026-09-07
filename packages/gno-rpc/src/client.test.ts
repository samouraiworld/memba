import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { GnoRpcClient, DEFAULT_RPC } from "./client.js"

// Chains that no longer exist. A default that names one of them is a client
// that fails on first use for everyone who did not set GNO_RPC_URL.
const RETIRED = ["test13", "testnet13", "topaz", "sapphire", "test12"]

describe("GnoRpcClient default endpoint", () => {
    const saved = process.env.GNO_RPC_URL
    beforeEach(() => { delete process.env.GNO_RPC_URL })
    afterEach(() => { if (saved !== undefined) process.env.GNO_RPC_URL = saved })

    it("never defaults to a retired chain host", () => {
        for (const marker of RETIRED) expect(DEFAULT_RPC.toLowerCase()).not.toContain(marker)
    })

    it("defaults to the pearl canonical node", () => {
        expect(DEFAULT_RPC).toBe("https://rpc.pearl.samourai.live:443")
        expect(new GnoRpcClient().rpcUrl).toBe(DEFAULT_RPC)
    })

    it("honors an explicit endpoint override", () => {
        expect(
            new GnoRpcClient({ endpoints: ["https://custom.example:443"] }).rpcUrl,
        ).toBe("https://custom.example:443")
    })

    it("honors GNO_RPC_URL when no explicit endpoint is given", () => {
        process.env.GNO_RPC_URL = "https://env.example:443"
        expect(new GnoRpcClient().rpcUrl).toBe("https://env.example:443")
    })
})
