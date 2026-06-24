import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { GnoRpcClient } from "./client.js"

describe("GnoRpcClient default endpoint", () => {
    const saved = process.env.GNO_RPC_URL
    beforeEach(() => { delete process.env.GNO_RPC_URL })
    afterEach(() => { if (saved !== undefined) process.env.GNO_RPC_URL = saved })

    it("defaults to the pinned test13 node (testnet12 is retired)", () => {
        expect(new GnoRpcClient().rpcUrl).toBe("https://rpc.testnet13.samourai.live:443")
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
