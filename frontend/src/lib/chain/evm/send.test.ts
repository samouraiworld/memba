import { connect, createConfig, http, injected, mock, switchChain, type Config } from "@wagmi/core"
import { base, baseSepolia } from "viem/chains"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SignResult } from "../../../os/sign/signer"
import type { TxResult } from "../types"
import { sendEvmWriteWith, type EvmWrite } from "./send"

const FROM = "0x1111111111111111111111111111111111111111"
const CONTRACT = "0x2222222222222222222222222222222222222222"
const EOA = "0x3333333333333333333333333333333333333333"
const OTHER = "0x4444444444444444444444444444444444444444"
const HASH = `0x${"ab".repeat(32)}` as const

// viem's receipt wait, replaceable per test (it follows replacements, which a stub RPC can't stage).
const receiptWait = vi.hoisted(() => ({ fake: null as null | ((args: { onReplaced?: (r: { reason: string }) => void }) => Promise<unknown>) }))
vi.mock("viem/actions", async (importOriginal) => {
    const real = await importOriginal<typeof import("viem/actions")>()
    return { ...real, waitForTransactionReceipt: (client: never, args: never) => receiptWait.fake ? receiptWait.fake(args) : real.waitForTransactionReceipt(client, args) }
})
const NEW_HASH = `0x${"cd".repeat(32)}` as const
const SEPOLIA = baseSepolia.id

// The chain's RPC: the mock wallet forwards eth_sendTransaction to it, and the public client reads it.
let code: Record<string, string>
let receiptStatus: "0x1" | "0x0" | null
let sent: Record<string, unknown>[]
let codeFails: boolean
let sendRpcError: { code: number; message: string } | null
function rpc(method: string, params: unknown[]): unknown {
    switch (method) {
        case "eth_chainId": return "0x14a34"
        case "eth_getCode":
            if (codeFails) throw new Error("rpc down")
            return code[(params[0] as string).toLowerCase()] ?? "0x"
        case "eth_sendTransaction": sent.push(params[0] as Record<string, unknown>); return HASH
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

function stubRpc() {
    code = { [CONTRACT]: "0x6080" }
    receiptStatus = "0x1"
    sent = []
    codeFails = false
    sendRpcError = null
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { id: number; method: string; params: unknown[] }
        if (sendRpcError && body.method === "eth_sendTransaction") return Response.json({ jsonrpc: "2.0", id: body.id, error: sendRpcError })
        try {
            return Response.json({ jsonrpc: "2.0", id: body.id, result: rpc(body.method, body.params) })
        } catch (err) {
            return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: (err as Error).message } })
        }
    }))
}

const transports = { [SEPOLIA]: http("https://rpc.test/sepolia"), [base.id]: http("https://rpc.test/base") }

/** wagmi's mock wallet (its chain follows switchChain). */
async function setup(opts: { walletChain?: number; accounts?: readonly [`0x${string}`, ...`0x${string}`[]] } = {}) {
    stubRpc()
    const config = createConfig({ chains: [baseSepolia, base], connectors: [mock({ accounts: opts.accounts ?? [FROM] })], multiInjectedProviderDiscovery: false, pollingInterval: 10, transports })
    await connect(config, { connector: config.connectors[0], chainId: SEPOLIA })
    if (opts.walletChain) await switchChain(config, { chainId: opts.walletChain as 8453 })
    return config
}

/** An injected wallet whose provider the test drives directly, behind wagmi's back. */
async function setupProvider() {
    stubRpc()
    const wallet = { chain: "0x14a34", chainWhenAccountsRead: null as string | null }
    const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
            switch (method) {
                case "eth_requestAccounts": return [FROM]
                case "eth_accounts":
                    if (wallet.chainWhenAccountsRead) { wallet.chain = wallet.chainWhenAccountsRead; wallet.chainWhenAccountsRead = null }
                    return [FROM]
                case "eth_chainId": return wallet.chain
                case "wallet_requestPermissions": case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }]
                case "eth_sendTransaction": sent.push((params as Record<string, unknown>[])[0]); return HASH
                default: throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 })
            }
        },
        on: () => {},
        removeListener: () => {},
    }
    const config = createConfig({
        chains: [baseSepolia, base], connectors: [injected({ target: () => ({ id: "fake", name: "Fake", provider: provider as never }) })],
        multiInjectedProviderDiscovery: false, pollingInterval: 10, transports,
    })
    await connect(config, { connector: config.connectors[0], chainId: SEPOLIA })
    return { config, wallet }
}

const send = (config: Config, write: EvmWrite, active: number | null = SEPOLIA, receiptTimeoutMs?: number) =>
    sendEvmWriteWith(config, active, write, { receiptTimeoutMs })

afterEach(() => { vi.unstubAllGlobals(); receiptWait.fake = null })

describe("sendEvmWriteWith: the one send path for EVM writes", () => {
    it("sends a contract call on the right chain and waits for its receipt", async () => {
        const config = await setup()
        expect(await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234", value: 0n })).toMatchObject({ outcome: "sent", hash: HASH })
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({ to: CONTRACT, data: "0x1234" })
    })

    it("sends a plain value transfer to an account without code", async () => {
        const config = await setup()
        expect(await send(config, { chainId: SEPOLIA, to: EOA, value: 5n })).toMatchObject({ outcome: "sent", hash: HASH })
        expect(sent[0]).toMatchObject({ to: EOA, value: "0x5" })
    })

    describe("writes only on this page's own network", () => {
        it("refuses a chain Memba doesn't run on", async () => {
            const config = await setup()
            expect(await send(config, { chainId: 1, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "Memba doesn't send transactions on chain 1. Nothing was sent." })
        })

        it("refuses Base mainnet, hidden before launch, on a Base Sepolia page", async () => {
            const config = await setup({ walletChain: base.id })
            expect(await send(config, { chainId: base.id, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "This transaction is for Base, but this page runs on Base Sepolia. Nothing was sent." })
            expect(sent).toHaveLength(0)
        })

        it("refuses any EVM write from a gno.land page", async () => {
            const config = await setup()
            expect(await send(config, { chainId: SEPOLIA, to: EOA, value: 1n }, null)).toEqual({ outcome: "failed", error: "This transaction is for Base Sepolia, but this page runs on gno.land. Nothing was sent." })
        })
    })

    it("refuses a malformed write before asking anything", async () => {
        const config = await setup()
        expect(await send(config, { chainId: SEPOLIA, to: "0x12" as `0x${string}`, value: 1n })).toEqual({ outcome: "failed", error: "The transaction names an invalid address. Nothing was sent." })
        expect(await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0xzz" as `0x${string}` })).toEqual({ outcome: "failed", error: "The transaction's data is not valid hex. Nothing was sent." })
        expect(await send(config, { chainId: SEPOLIA, to: EOA, value: -1n })).toEqual({ outcome: "failed", error: "The transaction's value is not a positive amount. Nothing was sent." })
        expect(sent).toHaveLength(0)
    })

    describe("contract calls need code at the target, read from an RPC that proves its chain", () => {
        it("refuses an address with no code: the call would succeed and do nothing", async () => {
            const config = await setup()
            expect(await send(config, { chainId: SEPOLIA, to: EOA, data: "0x1234" })).toEqual({ outcome: "failed", error: `There is no contract at ${EOA} on Base Sepolia. Nothing was sent.` })
            expect(sent).toHaveLength(0)
        })

        it("refuses when the code can't be read: an outage proves nothing", async () => {
            const config = await setup()
            codeFails = true
            expect(await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Memba couldn't read the contract on Base Sepolia to check it (the RPC did not answer). Nothing was sent." })
            expect(sent).toHaveLength(0)
        })
    })

    describe("the wallet, checked last, as its provider says now", () => {
        it("refuses a wallet on another chain", async () => {
            const config = await setup({ walletChain: base.id })
            expect(await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Your wallet is on chain 8453, but this transaction is for Base Sepolia (84532). Switch the wallet, then try again. Nothing was sent." })
            expect(sent).toHaveLength(0)
        })

        it("asks the provider, not wagmi's cached chain, which may be stale", async () => {
            const { config, wallet } = await setupProvider()
            wallet.chain = "0x2105" // the wallet moved without wagmi hearing of it
            expect(await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Your wallet is on chain 8453, but this transaction is for Base Sepolia (84532). Switch the wallet, then try again. Nothing was sent." })
            expect(sent).toHaveLength(0)
        })

        it("still refuses when the wallet moves between the check and the send: viem checks the chain too", async () => {
            const { config, wallet } = await setupProvider()
            // It moves right after the check (as it reads the account), before the send.
            wallet.chainWhenAccountsRead = "0x2105"
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Your wallet left Base Sepolia before sending. Switch it back, then try again. Nothing was sent." })
            expect(sent).toHaveLength(0)
        })

        it("refuses a chain answer that isn't one", async () => {
            const { config, wallet } = await setupProvider()
            wallet.chain = "not-a-chain"
            expect(await send(config, { chainId: SEPOLIA, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "Your wallet didn't say which chain it is on. Nothing was sent." })
        })

        it("sends from the account the write was prepared for, whatever its letter case", async () => {
            const config = await setup()
            expect(await send(config, { chainId: SEPOLIA, from: FROM.toUpperCase().replace("0X", "0x") as `0x${string}`, to: CONTRACT, data: "0x1234" })).toMatchObject({ outcome: "sent" })
            expect(sent[0]).toMatchObject({ from: FROM })
        })

        it("refuses when the wallet switched to another account after the review", async () => {
            // The wallet now puts another account first: the one the write was prepared for would not be the one paying.
            const config = await setup({ accounts: [OTHER, FROM] })
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Your wallet switched to another account. Nothing was sent." })
            expect(sent).toHaveLength(0)
        })
    })

    describe("what the wallet answers", () => {
        it("reads a rejection in the wallet as cancelled", async () => {
            const config = await setup()
            sendRpcError = { code: 4001, message: "User rejected the request." }
            expect(await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "cancelled", error: "You rejected the transaction in your wallet. Nothing was sent." })
        })

        it("does not claim nothing was sent for any other wallet error", async () => {
            const config = await setup()
            sendRpcError = { code: -32603, message: "Internal error" }
            const res = await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234" })
            expect(res.outcome).toBe("unknown")
            expect(res).not.toHaveProperty("hash")
            expect((res as { error: string }).error).toMatch(/Check your wallet's activity before retrying: the transaction may have been sent\.$/)
        })
    })

    describe("the receipt", () => {
        it("reports a reverted transaction as refused, with its hash: final, and the fee was paid", async () => {
            const config = await setup()
            receiptStatus = "0x0"
            expect(await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "refused", hash: HASH, error: "The transaction was included but reverted: it changed nothing, and the network fee was paid." })
        })

        it("reports a transaction whose receipt never came as unknown, with its hash", async () => {
            const config = await setup()
            receiptStatus = null
            expect(await send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234" }, SEPOLIA, 200)).toMatchObject({ outcome: "unknown", hash: HASH })
        })

        // viem follows a replacement and resolves with the replacement's receipt.
        async function replacedBy(reason: "replaced" | "repriced" | "cancelled" | null) {
            const config = await setup()
            receiptWait.fake = async (args) => {
                if (reason) args.onReplaced?.({ reason })
                return { transactionHash: NEW_HASH, status: "success" }
            }
            return send(config, { chainId: SEPOLIA, to: CONTRACT, data: "0x1234" })
        }

        it("counts a repriced transaction as the same write, under its new hash", async () => {
            expect(await replacedBy("repriced")).toMatchObject({ outcome: "sent", hash: NEW_HASH })
        })

        it("does not count a cancellation as the write", async () => {
            expect(await replacedBy("cancelled")).toEqual({ outcome: "refused", hash: NEW_HASH, error: "Your wallet cancelled this transaction with a replacement: the write did not happen." })
        })

        it("does not count a different transaction as the write, nor a receipt for another hash", async () => {
            expect(await replacedBy("replaced")).toMatchObject({ outcome: "unknown", hash: NEW_HASH })
            expect(await replacedBy(null)).toMatchObject({ outcome: "unknown", hash: NEW_HASH })
        })
    })

    it("returns what the OS signer understands", () => {
        const r: TxResult = { outcome: "unknown", error: "x" }
        const asSign: SignResult = r
        expect(asSign.outcome).toBe("unknown")
    })
})
