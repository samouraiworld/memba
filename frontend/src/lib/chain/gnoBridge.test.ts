import { describe, it, expect } from "vitest"
import { chainIdToConfigKey, configKeyToChainId } from "./gnoBridge"

describe("gnoBridge", () => {
    it("maps config keys to on-wire chainIds", () => {
        expect(configKeyToChainId("topaz")).toBe("topaz-1")
        expect(configKeyToChainId("test13")).toBe("test-13")
        expect(configKeyToChainId("gnoland1")).toBe("gnoland1")
    })

    it("maps on-wire chainIds back to config keys", () => {
        expect(chainIdToConfigKey("topaz-1")).toBe("topaz")
        expect(chainIdToConfigKey("test-13")).toBe("test13")
        expect(chainIdToConfigKey("gnoland1")).toBe("gnoland1")
    })

    it("round-trips every config key through its chainId and back", () => {
        for (const key of ["topaz", "test13", "gnoland1"]) {
            const chainId = configKeyToChainId(key)
            expect(chainId).toBeDefined()
            expect(chainIdToConfigKey(chainId!)).toBe(key)
        }
    })

    it("returns undefined for EVM and unknown chains (they have no config.ts entry)", () => {
        expect(chainIdToConfigKey("rh-mainnet-4663")).toBeUndefined()
        expect(chainIdToConfigKey("rh-testnet-46630")).toBeUndefined()
        expect(chainIdToConfigKey("not-a-chain")).toBeUndefined()
        expect(configKeyToChainId("not-a-key")).toBeUndefined()
    })
})
