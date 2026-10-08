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

// wagmi's send, observed (and replaceable) per test: what reaches it, and errors wagmi raises itself.
const wagmiSend = vi.hoisted(() => ({ calls: [] as unknown[], fake: null as null | (() => Promise<unknown>) }))
vi.mock("@wagmi/core", async (importOriginal) => {
    const real = await importOriginal<typeof import("@wagmi/core")>()
    return { ...real, sendTransaction: (config: never, args: never) => { wagmiSend.calls.push(args); return wagmiSend.fake ? wagmiSend.fake() : real.sendTransaction(config, args) } }
})

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
// Which chain each test RPC serves (a test can point one at the wrong chain).
let rpcChain: Record<string, string>
function rpc(url: string, method: string, params: unknown[]): unknown {
    switch (method) {
        case "eth_chainId": return rpcChain[url]
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
    rpcChain = { [SEPOLIA_RPC]: "0x14a34", [BASE_RPC]: "0x2105" }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { id: number; method: string; params: unknown[] }
        if (sendRpcError && body.method === "eth_sendTransaction") return Response.json({ jsonrpc: "2.0", id: body.id, error: sendRpcError })
        try {
            return Response.json({ jsonrpc: "2.0", id: body.id, result: rpc(url, body.method, body.params) })
        } catch (err) {
            return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: (err as Error).message } })
        }
    }))
}

const SEPOLIA_RPC = "https://rpc.test/sepolia"
const BASE_RPC = "https://rpc.test/base"
const transports = { [SEPOLIA]: http(SEPOLIA_RPC), [base.id]: http(BASE_RPC) }

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
    const wallet = { chain: "0x14a34" as unknown, chainWhenAccountsRead: null as string | null, chainError: null as null | { code: number }, chainErrorOnCall: 0, chainCalls: 0, accountsError: null as null | { code: number } }
    const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
            switch (method) {
                case "eth_requestAccounts": return [FROM]
                case "eth_accounts":
                    if (wallet.accountsError) throw Object.assign(new Error("accounts"), wallet.accountsError)
                    if (wallet.chainWhenAccountsRead) { wallet.chain = wallet.chainWhenAccountsRead; wallet.chainWhenAccountsRead = null }
                    return [FROM]
                case "eth_chainId":
                    // Fails on the given call after arming (0: every call), so each place that asks can be reached.
                    wallet.chainCalls++
                    if (wallet.chainError && (!wallet.chainErrorOnCall || wallet.chainCalls === wallet.chainErrorOnCall)) throw Object.assign(new Error("chain"), wallet.chainError)
                    return wallet.chain
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

afterEach(() => { vi.unstubAllGlobals(); receiptWait.fake = null; wagmiSend.fake = null; wagmiSend.calls = [] })

describe("sendEvmWriteWith: the one send path for EVM writes", () => {
    it("sends a contract call on the right chain and waits for its receipt", async () => {
        const config = await setup()
        expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234", value: 0n })).toMatchObject({ outcome: "sent", hash: HASH })
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({ to: CONTRACT, data: "0x1234" })
    })

    it("sends a plain value transfer to an account without code", async () => {
        const config = await setup()
        expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 5n })).toMatchObject({ outcome: "sent", hash: HASH })
        expect(sent[0]).toMatchObject({ to: EOA, value: "0x5" })
    })

    describe("writes only on this page's own network", () => {
        it("refuses a chain Memba doesn't run on", async () => {
            const config = await setup()
            expect(await send(config, { chainId: 1, from: FROM, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "Memba doesn't send transactions on chain 1. Nothing was sent." })
        })

        it("refuses Base mainnet, hidden before launch, on a Base Sepolia page", async () => {
            const config = await setup({ walletChain: base.id })
            expect(await send(config, { chainId: base.id, from: FROM, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "This transaction is for Base, but this page runs on Base Sepolia. Nothing was sent." })
            expect(sent).toHaveLength(0)
        })

        it("refuses any EVM write from a gno.land page", async () => {
            const config = await setup()
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n }, null)).toEqual({ outcome: "failed", error: "This transaction is for Base Sepolia, but this page runs on gno.land. Nothing was sent." })
        })
    })

    it("refuses a malformed write before asking anything", async () => {
        const config = await setup()
        expect(await send(config, { chainId: SEPOLIA, from: FROM, to: "0x12" as `0x${string}`, value: 1n })).toEqual({ outcome: "failed", error: "The transaction names an invalid address. Nothing was sent." })
        expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0xzz" as `0x${string}` })).toEqual({ outcome: "failed", error: "The transaction's data is not valid hex. Nothing was sent." })
        expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: -1n })).toEqual({ outcome: "failed", error: "The transaction's value is negative or not an amount. Nothing was sent." })
        expect(sent).toHaveLength(0)
    })

    describe("contract calls need code at the target, read from an RPC that proves its chain", () => {
        it("refuses an address with no code: the call would succeed and do nothing", async () => {
            const config = await setup()
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, data: "0x1234" })).toEqual({ outcome: "failed", error: `There is no contract at ${EOA} on Base Sepolia. Nothing was sent.` })
            expect(sent).toHaveLength(0)
        })

        it("trusts no code from an RPC that serves another chain", async () => {
            const config = await setup()
            rpcChain[SEPOLIA_RPC] = "0x2105"
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Memba couldn't read the contract on Base Sepolia to check it (the RPC answered as chain 8453, not 84532). Nothing was sent." })
            expect(sent).toHaveLength(0)
        })

        it("refuses when the code can't be read: an outage proves nothing", async () => {
            const config = await setup()
            codeFails = true
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Memba couldn't read the contract on Base Sepolia to check it (the RPC did not answer). Nothing was sent." })
            expect(sent).toHaveLength(0)
        })
    })

    describe("the wallet, checked last, as its provider says now", () => {
        it("refuses a wallet on another chain", async () => {
            const config = await setup({ walletChain: base.id })
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Your wallet is on chain 8453, but this transaction is for Base Sepolia (84532). Switch the wallet, then try again. Nothing was sent." })
            expect(sent).toHaveLength(0)
        })

        it("asks the provider, not wagmi's cached chain, which may be stale", async () => {
            const { config, wallet } = await setupProvider()
            wallet.chain = "0x2105" // the wallet moved without wagmi hearing of it
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "failed", error: "Your wallet is on chain 8453, but this transaction is for Base Sepolia (84532). Switch the wallet, then try again. Nothing was sent." })
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
            for (const answer of ["not-a-chain", "0x14a34zz", 84532]) {
                wallet.chain = answer
                expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "Your wallet didn't say which chain it is on. Nothing was sent." })
            }
            expect(sent).toHaveLength(0)
        })

        it("reads a rejection of the chain request as cancelled, wherever it is asked", async () => {
            const { config, wallet } = await setupProvider()
            const cancelled = { outcome: "cancelled", error: "You rejected the request in your wallet. Nothing was sent." }
            // As wagmi looks the wallet up (its first chain request), then at our own live check (the next one).
            for (const call of [1, 2]) {
                wallet.chainError = { code: 4001 }
                wallet.chainCalls = 0
                wallet.chainErrorOnCall = call
                expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n })).toEqual(cancelled)
                expect(wallet.chainCalls).toBe(call)
            }
            expect(sent).toHaveLength(0)
        })

        it("does not call an account request that failed a switch of account", async () => {
            const { config, wallet } = await setupProvider()
            wallet.accountsError = { code: -32603 }
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "Your wallet didn't say which account it is using. Nothing was sent." })
            wallet.accountsError = { code: 4001 }
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n })).toEqual({ outcome: "cancelled", error: "You rejected the request in your wallet. Nothing was sent." })
            expect(sent).toHaveLength(0)
        })

        it("sends from the account the write was prepared for, whatever its letter case, and names it to the send", async () => {
            const config = await setup()
            const from = FROM.toUpperCase().replace("0X", "0x") as `0x${string}`
            expect(await send(config, { chainId: SEPOLIA, from, to: CONTRACT, data: "0x1234" })).toMatchObject({ outcome: "sent" })
            expect(wagmiSend.calls[0]).toMatchObject({ chainId: SEPOLIA, account: from })
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
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "cancelled", error: "You rejected the transaction in your wallet. Nothing was sent." })
        })

        it("names what wagmi refused before asking the wallet: chain or account", async () => {
            const config = await setup()
            wagmiSend.fake = async () => { throw Object.assign(new Error("chain"), { name: "ConnectorChainMismatchError" }) }
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "Your wallet left Base Sepolia before sending. Switch it back, then try again. Nothing was sent." })
            wagmiSend.fake = async () => { throw Object.assign(new Error("account"), { name: "ConnectorAccountNotFoundError" }) }
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n })).toEqual({ outcome: "failed", error: "Your wallet switched to another account. Nothing was sent." })
        })

        it("treats an answer that is not a transaction hash as unknown, without a hash", async () => {
            const config = await setup()
            wagmiSend.fake = async () => "0x1234"
            const res = await send(config, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n })
            expect(res).toEqual({ outcome: "unknown", error: "Your wallet answered without a valid transaction hash. Check your wallet's activity before retrying: the transaction may have been sent." })
        })

        it("does not claim nothing was sent for any other wallet error", async () => {
            const config = await setup()
            sendRpcError = { code: -32603, message: "Internal error" }
            const res = await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })
            expect(res.outcome).toBe("unknown")
            expect(res).not.toHaveProperty("hash")
            expect((res as { error: string }).error).toMatch(/Check your wallet's activity before retrying: the transaction may have been sent\.$/)
        })
    })

    describe("the receipt", () => {
        it("reports a reverted transaction as refused, with its hash: final, and the fee was paid", async () => {
            const config = await setup()
            receiptStatus = "0x0"
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })).toEqual({ outcome: "refused", hash: HASH, error: "The transaction was included but reverted: it changed nothing, and the network fee was paid." })
        })

        it("reports a transaction whose receipt never came as unknown, with its hash", async () => {
            const config = await setup()
            receiptStatus = null
            expect(await send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" }, SEPOLIA, 200)).toMatchObject({ outcome: "unknown", hash: HASH })
        })

        // viem follows a replacement and resolves with the replacement's receipt.
        async function replacedBy(reason: "replaced" | "repriced" | "cancelled" | null) {
            const config = await setup()
            receiptWait.fake = async (args) => {
                if (reason) args.onReplaced?.({ reason })
                return { transactionHash: NEW_HASH, status: "success" }
            }
            return send(config, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" })
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

    describe("onSent: the hash, as soon as the wallet gives it", () => {
        it("is called once with the hash, before the receipt is awaited", async () => {
            const config = await setup()
            const order: string[] = []
            receiptWait.fake = async () => { order.push("receipt"); return { transactionHash: HASH, status: "success" } }
            const onSent = vi.fn((h: string) => { order.push(`sent ${h}`) })
            expect(await sendEvmWriteWith(config, SEPOLIA, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" }, { onSent })).toMatchObject({ outcome: "sent", hash: HASH })
            expect(onSent).toHaveBeenCalledTimes(1)
            expect(order).toEqual([`sent ${HASH}`, "receipt"])
        })

        it("is not called when nothing was sent, nor when the wallet's answer is not a hash", async () => {
            const onSent = vi.fn()
            const config = await setup({ walletChain: base.id })
            expect((await sendEvmWriteWith(config, SEPOLIA, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" }, { onSent })).outcome).toBe("failed")
            const rejecting = await setup()
            sendRpcError = { code: 4001, message: "User rejected the request." }
            expect((await sendEvmWriteWith(rejecting, SEPOLIA, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" }, { onSent })).outcome).toBe("cancelled")
            wagmiSend.fake = async () => "0x1234"
            expect((await sendEvmWriteWith(rejecting, SEPOLIA, { chainId: SEPOLIA, from: FROM, to: EOA, value: 1n }, { onSent })).outcome).toBe("unknown")
            expect(onSent).not.toHaveBeenCalled()
        })

        it("cannot change the outcome by throwing", async () => {
            const config = await setup()
            const onSent = vi.fn(() => { throw new Error("storage full") })
            expect(await sendEvmWriteWith(config, SEPOLIA, { chainId: SEPOLIA, from: FROM, to: CONTRACT, data: "0x1234" }, { onSent })).toMatchObject({ outcome: "sent", hash: HASH })
            expect(onSent).toHaveBeenCalledTimes(1)
        })
    })
})
