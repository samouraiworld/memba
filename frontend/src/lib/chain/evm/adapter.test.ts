import { afterEach, describe, expect, it } from "vitest"
import { base, baseSepolia } from "viem/chains"
import { EVM_NETWORKS } from "./networks"
import { chainFor, evmConfig, sendEvmWrite } from "./adapter"
import { NETWORK_PREF_STORAGE_KEY } from "../../config"

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

describe("sendEvmWrite", () => {
    afterEach(() => localStorage.clear())
    const write = { chainId: 84532, from: "0x1111111111111111111111111111111111111111", to: "0x3333333333333333333333333333333333333333", value: 1n } as const

    it("writes only on the network this page runs on: Base Sepolia passes the network check", async () => {
        localStorage.setItem(NETWORK_PREF_STORAGE_KEY, "base-sepolia")
        // Past the network check, it stops at the wallet: none is connected here.
        expect(await sendEvmWrite(write)).toEqual({ outcome: "failed", error: "Connect your wallet first. Nothing was sent." })
    })

    it("treats hidden Base mainnet, stored as the preference, as no EVM page at all", async () => {
        localStorage.setItem(NETWORK_PREF_STORAGE_KEY, "base")
        expect(await sendEvmWrite({ ...write, chainId: 8453 })).toEqual({ outcome: "failed", error: "This transaction is for Base, but this page runs on gno.land. Nothing was sent." })
    })
})
