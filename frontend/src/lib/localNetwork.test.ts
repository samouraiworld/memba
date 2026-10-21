import { describe, expect, it } from "vitest"
import { LOCAL_CHAIN_ID, LOCAL_GNOWEB_URL, LOCAL_NETWORK_KEY, LOCAL_RPC_URL, localNetworkEnabled } from "./localNetwork"

describe("the dev-only local network", () => {
    it("is gnodev's defaults", () => {
        expect(LOCAL_NETWORK_KEY).toBe("local")
        expect(LOCAL_CHAIN_ID).toBe("dev")
        expect(LOCAL_RPC_URL).toBe("http://localhost:26657")
        expect(LOCAL_GNOWEB_URL).toBe("http://localhost:8888")
    })

    it("is on only with the flag set to exactly \"true\", and never in unit tests", () => {
        expect(localNetworkEnabled("development", "true")).toBe(true)
        expect(localNetworkEnabled("test", "true")).toBe(false)
        expect(localNetworkEnabled("development", "TRUE")).toBe(false)
        expect(localNetworkEnabled("development", "1")).toBe(false)
        expect(localNetworkEnabled("development", "")).toBe(false)
        expect(localNetworkEnabled("development", undefined)).toBe(false)
    })
})
