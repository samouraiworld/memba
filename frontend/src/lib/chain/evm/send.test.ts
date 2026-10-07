import { createConfig, http, mock, connect, switchChain } from "@wagmi/core"
import { UserRejectedRequestError } from "viem"
import { base, baseSepolia } from "viem/chains"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SignResult } from "../../../os/sign/signer"
import type { TxResult } from "../types"
import { sendEvmWriteWith } from "./send"

const FROM = "0x1111111111111111111111111111111111111111"
const CONTRACT = "0x2222222222222222222222222222222222222222"
const EOA = "0x3333333333333333333333333333333333333333"
const HASH = `0x${"ab".repeat(32)}` as const

// The chain's RPC (the mock wallet forwards eth_sendTransaction to it, the public client reads it).
let code: Record<string, string>
let receiptStatus: "0x1" | "0x0" | null
let sent: unknown[]
let codeFails: boolean
let onGetCode: (() => Promise<void>) | null
function rpc(method: string, params: unknown[]): unknown {
    switch (method) {
        case "eth_chainId": return "0x14a34"
        case "eth_getCode":
            if (codeFails) throw new Error("rpc down")
            return code[(params[0] as string).toLowerCase()] ?? "0x"
        case "eth_sendTransaction": sent.push(params[0]); return HASH
        case "eth_blockNumber": return "0x10"
        case "eth_getTransactionReceipt":
            return receiptStatus === null ? null : {
                transactionHash: HASH, status: receiptStatus, blockNumber: "0x10", blockHash: HASH, transactionIndex: "0x0", from: FROM, to: CONTRACT,
                cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", logs: [], logsBloom: `0x${"0".repeat(512)}`, type: "0x2", contractAddress: null,
            }
        case "eth_getTransactionByHash": return null
        default: throw new Error(`unexpected ${method}`)
    }
}

async function setup(opts: { sendError?: Error; walletChain?: number } = {}) {
    code = { [CONTRACT]: "0x6080" }
    receiptStatus = "0x1"
    sent = []
    codeFails = false
    onGetCode = null
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { id: number; method: string; params: unknown[] }
        if (body.method === "eth_getCode" && onGetCode) await onGetCode()
        try {
            if (opts.sendError && body.method === "eth_sendTransaction") throw opts.sendError
            return Response.json({ jsonrpc: "2.0", id: body.id, result: rpc(body.method, body.params) })
        } catch (err) {
            if (err === opts.sendError) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: 4001, message: "User rejected the request." } })
            return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: (err as Error).message } })
        }
    }))
    const config = createConfig({
        chains: [baseSepolia, base],
        connectors: [mock({ accounts: [FROM] })],
        multiInjectedProviderDiscovery: false,
        pollingInterval: 10,
        transports: { [baseSepolia.id]: http("https://rpc.test/sepolia"), [base.id]: http("https://rpc.test/base") },
    })
    await connect(config, { connector: config.connectors[0], chainId: baseSepolia.id })
    if (opts.walletChain) await switchChain(config, { chainId: opts.walletChain as 8453 })
    return config
}

afterEach(() => vi.unstubAllGlobals())

describe("sendEvmWriteWith: the one send path for EVM writes", () => {
    it("sends a contract call on the right chain and waits for its receipt", async () => {
        const config = await setup()
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: CONTRACT, data: "0x1234", value: 0n })
        expect(res).toMatchObject({ outcome: "sent", hash: HASH })
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({ to: CONTRACT, data: "0x1234" })
    })

    it("refuses when the wallet is on another chain, before anything is sent", async () => {
        const config = await setup({ walletChain: base.id })
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: CONTRACT, data: "0x1234" })
        expect(res).toEqual({ outcome: "failed", error: "Your wallet is on chain 8453, but this transaction is for Base Sepolia (84532). Switch the wallet, then try again. Nothing was sent." })
        expect(sent).toHaveLength(0)
    })

    it("still refuses when the wallet switches chain after the check: the chain goes to the send too", async () => {
        const config = await setup()
        onGetCode = async () => { await switchChain(config, { chainId: base.id }) }
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: CONTRACT, data: "0x1234" })
        expect(res).toEqual({ outcome: "failed", error: "Your wallet left Base Sepolia before sending. Switch it back, then try again. Nothing was sent." })
        expect(sent).toHaveLength(0)
    })

    it("refuses a contract call to an address with no code: it would succeed and do nothing", async () => {
        const config = await setup()
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: EOA, data: "0x1234" })
        expect(res).toEqual({ outcome: "failed", error: `There is no contract at ${EOA} on Base Sepolia. Nothing was sent.` })
        expect(sent).toHaveLength(0)
    })

    it("refuses a contract call when the code can't be read: an outage proves nothing", async () => {
        const config = await setup()
        codeFails = true
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: CONTRACT, data: "0x1234" })
        expect(res).toEqual({ outcome: "failed", error: "Memba couldn't read the contract on Base Sepolia to check it. Nothing was sent." })
        expect(sent).toHaveLength(0)
    })

    it("sends a plain value transfer to an account without code", async () => {
        const config = await setup()
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: EOA, value: 5n })
        expect(res).toMatchObject({ outcome: "sent", hash: HASH })
        expect(sent[0]).toMatchObject({ to: EOA, value: "0x5" })
    })

    it("refuses a chain Memba doesn't run on", async () => {
        const config = await setup()
        expect(await sendEvmWriteWith(config, { chainId: 1, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "Memba doesn't send transactions on chain 1. Nothing was sent." })
    })

    it("reads a rejection in the wallet as cancelled", async () => {
        const config = await setup({ sendError: new UserRejectedRequestError(new Error("User rejected the request.")) })
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: CONTRACT, data: "0x1234" })
        expect(res).toEqual({ outcome: "cancelled", error: "You rejected the transaction in your wallet. Nothing was sent." })
    })

    it("reports a reverted transaction as refused, with its hash: it is final and the fee was paid", async () => {
        const config = await setup()
        receiptStatus = "0x0"
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: CONTRACT, data: "0x1234" })
        expect(res).toEqual({ outcome: "refused", hash: HASH, error: "The transaction was included but reverted: it changed nothing, and the network fee was paid." })
    })

    it("reports a transaction whose receipt never came as unknown, with its hash", async () => {
        const config = await setup()
        receiptStatus = null
        const res = await sendEvmWriteWith(config, { chainId: baseSepolia.id, to: CONTRACT, data: "0x1234" }, { receiptTimeoutMs: 200 })
        expect(res).toMatchObject({ outcome: "unknown", hash: HASH })
    })

    it("returns what the OS signer understands", () => {
        const r: TxResult = { outcome: "sent", hash: HASH }
        const asSign: SignResult = r
        expect(asSign.outcome).toBe("sent")
    })
})
