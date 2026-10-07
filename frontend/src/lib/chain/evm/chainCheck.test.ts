import { describe, expect, it } from "vitest"
import { readChainStatus, readCode } from "./chainCheck"

const reader = (chainId: number | Error, block: bigint | Error = 7n) => ({
    getChainId: async () => { if (chainId instanceof Error) throw chainId; return chainId },
    getBlockNumber: async () => { if (block instanceof Error) throw block; return block },
})

describe("readChainStatus", () => {
    it("reports the latest block once the RPC proves it serves the expected chain", async () => {
        expect(await readChainStatus(84532, reader(84532, 123n))).toEqual({ kind: "ok", value: { blockNumber: 123n } })
    })

    it("refuses an RPC that answers as another chain: an answer is not the chain asked for", async () => {
        expect(await readChainStatus(84532, reader(8453))).toEqual({ kind: "unavailable", reason: "the RPC answered as chain 8453, not 84532" })
    })

    it("reports an RPC failure as unavailable, never as an empty or absent value", async () => {
        expect(await readChainStatus(84532, reader(new Error("fetch failed")))).toEqual({ kind: "unavailable", reason: "the RPC did not answer" })
        expect(await readChainStatus(84532, reader(84532, new Error("timeout")))).toEqual({ kind: "unavailable", reason: "the RPC did not answer" })
    })
})

describe("readCode", () => {
    const at = "0x2222222222222222222222222222222222222222"
    const codeReader = (chainId: number | Error, code: string | undefined | Error) => ({
        getChainId: async () => { if (chainId instanceof Error) throw chainId; return chainId },
        getCode: async () => { if (code instanceof Error) throw code; return code },
    })

    it("reads the code once the RPC proves its chain; no code reads as 0x", async () => {
        expect(await readCode(84532, codeReader(84532, "0x6080"), at)).toEqual({ kind: "ok", value: "0x6080" })
        expect(await readCode(84532, codeReader(84532, undefined), at)).toEqual({ kind: "ok", value: "0x" })
    })

    it("trusts no code read from an RPC on another chain, or one that fails", async () => {
        expect(await readCode(84532, codeReader(8453, "0x6080"), at)).toEqual({ kind: "unavailable", reason: "the RPC answered as chain 8453, not 84532" })
        expect(await readCode(84532, codeReader(84532, new Error("down")), at)).toEqual({ kind: "unavailable", reason: "the RPC did not answer" })
    })
})
