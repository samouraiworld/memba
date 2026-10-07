import { describe, expect, it } from "vitest"
import { base, baseSepolia } from "viem/chains"
import { EVM_NETWORKS } from "./networks"
import { chainFor, evmConfig } from "./adapter"

describe("EVM adapter config", () => {
    it("knows every registry network by the same chain id as viem", () => {
        expect(chainFor("base-sepolia")).toBe(baseSepolia)
        expect(chainFor("base")).toBe(base)
        for (const [key, n] of Object.entries(EVM_NETWORKS)) expect(chainFor(key).id).toBe(n.chainId)
    })

    it("offers injected wallets only", () => {
        expect(evmConfig.connectors.every((c) => c.type === "injected")).toBe(true)
    })

    it("keeps its wallet state under Memba's own storage key", () => {
        expect(evmConfig.storage?.key).toBe("memba.evm")
    })
})
