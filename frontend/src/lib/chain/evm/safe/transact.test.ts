import { beforeEach, describe, expect, it, vi } from "vitest"
import { decodeFunctionData, encodeFunctionData, encodePacked, keccak256, parseAbi, size, toBytes, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { SafeActionError } from "./create"
import { assertBuilt, assertRunnable, confirmSafeTx, encodeSignatures, executeSafeTx, proposeSafeTx, type SafeCall } from "./transact"
import { safeTxHash, safeTxTypedData } from "./verify"

const KEYS = {
    a: "0x0000000000000000000000000000000000000000000000000000000000000a11",
    b: "0x0000000000000000000000000000000000000000000000000000000000000b0b",
    c: "0x0000000000000000000000000000000000000000000000000000000000000ca1",
} as const
const A = privateKeyToAccount(KEYS.a), B = privateKeyToAccount(KEYS.b), C = privateKeyToAccount(KEYS.c)
const byAddress = new Map([A, B, C].map((x) => [x.address.toLowerCase(), x]))

const CHAIN = 84532
const SAFE: Hex = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const owners = [A, B, C].map((x) => x.address.toLowerCase() as Hex)
const CALL_ONLY: Hex = "0xA83c336B20401Af773B6219BA5027174338D1836"
const FULL_MULTISEND: Hex = "0x218543288004CD07832472D464648173c77D7eB7"
const ZERO: Hex = "0x0000000000000000000000000000000000000000"
const P1: Hex = "0x1111111111111111111111111111111111111111"
const P2: Hex = "0x2222222222222222222222222222222222222222"
const SENT: Hex = `0x${"ee".repeat(32)}`
const EXEC_ABI = parseAbi(["function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)"])
const EXECUTION_SUCCESS = keccak256(toBytes("ExecutionSuccess(bytes32,uint256)"))

const m = vi.hoisted(() => ({
    me: "", walletChain: 84532, code: vi.fn(), send: vi.fn(), receipt: vi.fn(), signRequests: 0, signAs: "" as string, lowV: false,
    facts: { owners: [] as string[], threshold: 2, nonce: 3n }, inspect: vi.fn(),
    kit: { createTransaction: vi.fn() },
    service: { getNextNonce: vi.fn(), proposeTransaction: vi.fn(), getTransaction: vi.fn(), confirmTransaction: vi.fn() },
}))
vi.mock("@wagmi/core", async (orig) => ({
    ...(await orig<typeof import("@wagmi/core")>()),
    getConnectorClient: async () => ({ account: { address: m.me }, request: async () => `0x${m.walletChain.toString(16)}` }),
    getPublicClient: () => ({ getCode: m.code, waitForTransactionReceipt: m.receipt }),
    signTypedData: async (_config: unknown, args: { account: string } & Parameters<typeof A.signTypedData>[0]) => {
        m.signRequests++
        const { account, ...typed } = args
        const sig = await byAddress.get((m.signAs || account).toLowerCase())!.signTypedData(typed)
        // Some wallets answer v as 0/1.
        return m.lowV ? `${sig.slice(0, 130)}${(parseInt(sig.slice(130), 16) - 27).toString(16).padStart(2, "0")}` : sig
    },
}))
vi.mock("../adapter", async (orig) => ({ ...(await orig<typeof import("../adapter")>()), sendEvmWrite: m.send }))
vi.mock("@safe-global/protocol-kit", () => ({ default: { init: async () => m.kit } }))
vi.mock("./txService", () => ({ safeApiKit: () => m.service }))
vi.mock("./inspect", () => ({ inspectSafe: m.inspect }))
vi.mock("./reader", () => ({ safeReader: () => ({}) }))

const pay = (to: Hex, value: bigint): SafeCall => ({ to, value, data: "0x" })
const fields = (over: object = {}) => ({ to: P1, value: "5", data: "0x", operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: ZERO, refundReceiver: ZERO, nonce: 3, ...over })
type Fields = ReturnType<typeof fields>
function batch(calls: { operation?: number; to: Hex; value: bigint; data: Hex }[]): Hex {
    const packed = calls.map((t) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [t.operation ?? 0, t.to, t.value, BigInt(size(t.data)), t.data]))
    return encodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions)"]), functionName: "multiSend", args: [`0x${packed.map((p) => p.slice(2)).join("")}`] })
}
const hashOf = (f: Fields) => safeTxHash(CHAIN, { ...f, safe: SAFE })
const signOf = (who: typeof A, f: Fields) => who.signTypedData(safeTxTypedData(CHAIN, { ...f, safe: SAFE }))
async function listed(f: Fields, signers: (typeof A)[], extra: object = {}) {
    const hash = hashOf(f)
    const confirmations = await Promise.all(signers.map(async (s) => ({ owner: s.address, signature: await signOf(s, f) })))
    m.service.getTransaction.mockResolvedValue({ ...f, safe: SAFE, safeTxHash: hash, confirmations, ...extra })
    return hash
}
function code(p: Promise<unknown>): Promise<unknown> {
    return p.then(() => "ok", (err) => (err instanceof SafeActionError ? err.reason.code : `other: ${String(err)}`))
}
const successReceipt = (hash: Hex) => ({ status: "success", logs: [{ address: SAFE, topics: [EXECUTION_SUCCESS, hash], data: `0x${"00".repeat(32)}` }] })

beforeEach(() => {
    vi.clearAllMocks()
    m.me = A.address
    m.walletChain = CHAIN
    m.signRequests = 0
    m.signAs = ""
    m.lowV = false
    m.facts = { owners, threshold: 2, nonce: 3n }
    m.inspect.mockImplementation(async () => ({ kind: "ok", value: { kind: "safe", ...m.facts } }))
    m.code.mockResolvedValue(undefined)
    m.service.getNextNonce.mockResolvedValue("3")
    m.kit.createTransaction.mockImplementation(async (args: { options: { nonce: number } }) => ({ data: fields({ nonce: args.options.nonce }) }))
    m.send.mockResolvedValue({ outcome: "unknown", hash: SENT, error: "not seen yet" })
})

describe("checking a built Safe transaction before signing", () => {
    const refusal = (tx: Fields, calls: SafeCall[]) => {
        try { assertBuilt(tx, calls) } catch (err) { return err instanceof SafeActionError && err.reason.code === "unexpected-transaction" ? err.reason.detail : String(err) }
        return "accepted"
    }

    it("accepts exactly one asked call, or a call-only batch of exactly the asked calls", () => {
        expect(refusal(fields(), [pay(P1, 5n)])).toBe("accepted")
        const calls = [pay(P1, 1n), pay(P2, 2n)]
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: batch(calls) }), calls)).toBe("accepted")
    })

    it("refuses another call, value, operation, any gas refund, a full MultiSend, or a batch that differs", () => {
        expect(refusal(fields({ value: "6" }), [pay(P1, 5n)])).toBe("not the call asked for")
        expect(refusal(fields({ to: P2 }), [pay(P1, 5n)])).toBe("not the call asked for")
        expect(refusal(fields({ operation: 1 }), [pay(P1, 5n)])).toBe("not the call asked for")
        expect(refusal(fields({ data: "0x12" }), [pay(P1, 5n)])).toBe("not the call asked for")
        for (const over of [{ gasPrice: "1" }, { safeTxGas: "1" }, { baseGas: "1" }, { gasToken: P2 }, { refundReceiver: P2 }]) expect(refusal(fields(over), [pay(P1, 5n)])).toMatch(/^it (pays for gas|sets a gas limit)/)
        const calls = [pay(P1, 1n), pay(P2, 2n)]
        expect(refusal(fields({ to: FULL_MULTISEND, value: "0", operation: 1, data: batch(calls) }), calls)).toBe("not a call-only batch")
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: batch([calls[1], calls[0]]) }), calls)).toBe("not the calls asked for")
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: batch([calls[0]]) }), calls)).toBe("not the calls asked for")
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: "0x8d80ff0a00" }), calls)).toBe("an unreadable batch")
        expect(refusal(fields(), [])).toBe("no call")
    })

    it("refuses to run a queued transaction that pays a refund, delegatecalls anything but a call-only batch, or can't be read", () => {
        const runnable = (tx: Fields) => { try { assertRunnable(SAFE, tx); return "ok" } catch (err) { return (err as SafeActionError).reason.code } }
        expect(runnable(fields())).toBe("ok")
        expect(runnable(fields({ baseGas: "3900000", gasPrice: "1000000000000", refundReceiver: P2 }))).toBe("unexpected-transaction")
        expect(runnable(fields({ to: P2, operation: 1, data: "0x12345678" }))).toBe("unexpected-transaction")
        expect(runnable(fields({ to: FULL_MULTISEND, value: "0", operation: 1, data: batch([{ operation: 1, to: P2, value: 0n, data: "0x12" }]) }))).toBe("unexpected-transaction")
        expect(runnable(fields({ to: FULL_MULTISEND, value: "0", operation: 1, data: batch([{ to: P2, value: 1n, data: "0x" }]) }))).toBe("ok")
        expect(runnable(fields({ data: "0x12" }))).toBe("unexpected-transaction")
    })
})

describe("encoding the signatures execTransaction reads", () => {
    it("sorts them by owner and adds an owner executor's approval as v = 1", () => {
        // Inserted in descending address order: only sorting puts them right.
        const sorted = [...owners].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1))
        const fill = (o: string) => (o === sorted[0] ? "aa" : o === sorted[1] ? "bb" : "cc").repeat(65)
        const sigs = new Map<string, Hex>([[sorted[1], `0x${fill(sorted[1])}`], [sorted[0], `0x${fill(sorted[0])}`]])
        const out = encodeSignatures(sigs, sorted[2])
        expect(size(out)).toBe(65 * 3)
        expect(out).toBe(`0x${fill(sorted[0])}${fill(sorted[1])}${sorted[2].slice(2).padStart(64, "0")}${"00".repeat(32)}01`)
        const reversed = encodeSignatures(new Map<string, Hex>([[sorted[2], `0x${fill(sorted[2])}`], [sorted[0], `0x${fill(sorted[0])}`]]), null)
        expect(reversed).toBe(`0x${fill(sorted[0])}${fill(sorted[2])}`)
        expect(size(encodeSignatures(sigs, owners[0]))).toBe(130)
        expect(size(encodeSignatures(sigs, null))).toBe(130)
    })
})

describe("proposing", () => {
    it("signs Memba's own typed data at max(service, chain) nonce, checks the signature, then proposes", async () => {
        m.service.getNextNonce.mockResolvedValue("2")
        m.facts.nonce = 5n
        const hash = await proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)])
        expect(m.kit.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ onlyCalls: true, options: { nonce: 5 } }))
        expect(hash).toBe(hashOf(fields({ nonce: 5 })))
        const sent = m.service.proposeTransaction.mock.calls[0][0]
        expect(sent).toMatchObject({ safeTxHash: hash, origin: "Memba" })
        expect(sent.senderSignature).toBe(await signOf(A, fields({ nonce: 5 })))
        m.service.getNextNonce.mockResolvedValue("9")
        await proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)])
        expect(m.kit.createTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ options: { nonce: 9 } }))
    })

    it("refuses a non-owner, a wallet on another chain, a smart-account owner, a built tx that differs, and a signature that isn't the owner's", async () => {
        m.me = "0x9999999999999999999999999999999999999999"
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("not-owner")
        m.me = A.address
        m.walletChain = 8453
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("wrong-chain")
        m.walletChain = CHAIN
        m.code.mockResolvedValueOnce("0x6080604052")
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("contract-signer")
        m.code.mockResolvedValueOnce(`0xef0100${"12".repeat(20)}`)
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("ok")
        m.kit.createTransaction.mockResolvedValueOnce({ data: fields({ gasPrice: "1" }) })
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("unexpected-transaction")
        m.signAs = B.address
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("failed")
        expect(m.service.proposeTransaction).toHaveBeenCalledTimes(1)
    })

    it("accepts a typed-data signature with v as 0/1, normalised to 27/28, and still checks it is the owner's", async () => {
        m.lowV = true
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("ok")
        const sig: string = m.service.proposeTransaction.mock.calls[0][0].senderSignature
        expect(["1b", "1c"]).toContain(sig.slice(130))
        expect(sig).toBe(await signOf(A, fields()))
        m.signAs = B.address
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("failed")
    })

    it("refuses a service nonce far ahead of the Safe's on-chain nonce", async () => {
        m.service.getNextNonce.mockResolvedValue("54")
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("service")
        m.service.getNextNonce.mockResolvedValue("53")
        expect(await code(proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]))).toBe("ok")
        expect(m.service.proposeTransaction).toHaveBeenCalledTimes(1)
    })

    it("says what the Transaction Service refused", async () => {
        m.service.proposeTransaction.mockRejectedValue(new Error("Signer=0x… is not an owner or delegate"))
        const err = await proposeSafeTx("base-sepolia", "https://api.test", SAFE, [pay(P1, 5n)]).catch((e) => e)
        expect(err.reason).toEqual({ code: "service", detail: "Signer=0x… is not an owner or delegate" })
    })
})

describe("confirming", () => {
    it("signs a listed transaction once, only if it is this Safe's, its hash its own, and runnable", async () => {
        const hash = await listed(fields(), [B])
        expect(await code(confirmSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("ok")
        expect(m.service.confirmTransaction).toHaveBeenCalledWith(hash, await signOf(A, fields()))
        await listed(fields(), [A])
        expect(await code(confirmSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("not-ready")
        // A listed "A" signature that is really C's doesn't count as A's: A can still sign.
        m.service.getTransaction.mockResolvedValue({ ...fields(), safe: SAFE, safeTxHash: hash, confirmations: [{ owner: A.address, signature: await signOf(C, fields()) }] })
        expect(await code(confirmSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("ok")
        await listed(fields(), [B], { safe: P2 })
        expect(await code(confirmSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("hash-mismatch")
        m.service.getTransaction.mockResolvedValue({ ...fields({ value: "999" }), safe: SAFE, safeTxHash: hash, confirmations: [] })
        expect(await code(confirmSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("hash-mismatch")
        const drain = fields({ baseGas: "3900000", gasPrice: "1000000000000", refundReceiver: P2 })
        const drainHash = await listed(drain, [B])
        expect(await code(confirmSafeTx("base-sepolia", "https://api.test", SAFE, drainHash))).toBe("unexpected-transaction")
        m.me = "0x9999999999999999999999999999999999999999"
        await listed(fields(), [B])
        expect(await code(confirmSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("not-owner")
        expect(m.service.confirmTransaction).toHaveBeenCalledTimes(2)
        expect(m.signRequests).toBe(2)
    })
})

describe("executing", () => {
    const sentSignatures = () => decodeFunctionData({ abi: EXEC_ABI, data: m.send.mock.calls.at(-1)![0].data }).args[9]

    it("executes at the on-chain nonce with the recovered signatures only, and an owner executor's approval", async () => {
        // B signed; C's listed signature is really A's (does not count); A executes and approves.
        const f = fields()
        const hash = hashOf(f)
        m.service.getTransaction.mockResolvedValue({ ...f, safe: SAFE, safeTxHash: hash, confirmations: [{ owner: B.address, signature: await signOf(B, f) }, { owner: C.address, signature: await signOf(A, f) }] })
        m.receipt.mockResolvedValue(successReceipt(hash))
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("ok")
        const sigs = sentSignatures()
        expect(size(sigs)).toBe(130)
        expect(sigs).toContain((await signOf(B, f)).slice(2))
        expect(sigs).toContain(`${owners[0].slice(2).padStart(64, "0")}${"00".repeat(32)}01`)
        expect(m.send.mock.calls[0][0]).toMatchObject({ from: A.address.toLowerCase(), chainId: CHAIN, to: SAFE })
        expect(m.send.mock.calls[0][1]).toEqual({ receiptTimeoutMs: 1 })
    })

    it("doesn't count an owner executor twice, nor a non-owner executor, nor a misattributed signature", async () => {
        const f = fields()
        const hash = await listed(f, [A])
        // A signed already and executes: 1 of 2.
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("not-ready")
        await listed(f, [B])
        m.me = "0x9999999999999999999999999999999999999999"
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("not-ready")
        m.me = A.address
        m.service.getTransaction.mockResolvedValue({ ...f, safe: SAFE, safeTxHash: hash, confirmations: [{ owner: B.address, signature: await signOf(C, f) }] })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("not-ready")
        expect(m.send).not.toHaveBeenCalled()
    })

    it("adds no approval for an executor who isn't an owner", async () => {
        const f = fields()
        const hash = await listed(f, [A, B])
        m.receipt.mockResolvedValue(successReceipt(hash))
        m.me = "0x9999999999999999999999999999999999999999"
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("ok")
        expect(size(sentSignatures())).toBe(130)
        expect(sentSignatures()).not.toContain("9999999999999999999999999999999999999999")
    })

    it("never executes another Safe's transaction, even one whose own hash and signatures are valid", async () => {
        const f = fields()
        const otherHash = safeTxHash(CHAIN, { ...f, safe: P2 })
        const sig = (who: typeof A) => who.signTypedData(safeTxTypedData(CHAIN, { ...f, safe: P2 }))
        m.service.getTransaction.mockResolvedValue({ ...f, safe: P2, safeTxHash: otherHash, confirmations: [{ owner: A.address, signature: await sig(A) }, { owner: B.address, signature: await sig(B) }] })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, otherHash))).toBe("hash-mismatch")
        expect(await code(confirmSafeTx("base-sepolia", "https://api.test", SAFE, otherHash))).toBe("hash-mismatch")
        expect(m.send).not.toHaveBeenCalled()
    })

    it("re-reads the Safe on chain: another nonce, fewer owners or a higher threshold stop it", async () => {
        const f = fields()
        const hash = await listed(f, [B])
        m.facts.nonce = 4n
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("not-ready")
        m.facts = { owners, threshold: 3, nonce: 3n }
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("not-ready")
        m.facts = { owners: [owners[0], owners[2]], threshold: 2, nonce: 3n }
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("not-ready")
        m.inspect.mockResolvedValueOnce({ kind: "unavailable", reason: "the RPC did not answer" })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("failed")
        expect(m.send).not.toHaveBeenCalled()
    })

    it("refuses the refund drain, a delegatecall, a hash mismatch and another Safe's transaction", async () => {
        const drain = fields({ value: "1", baseGas: "3900000", gasPrice: "1000000000000", refundReceiver: P2 })
        const drainHash = await listed(drain, [A, B])
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, drainHash))).toBe("unexpected-transaction")
        const dc = fields({ to: P2, operation: 1, data: "0x12345678" })
        const dcHash = await listed(dc, [A, B])
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, dcHash))).toBe("unexpected-transaction")
        const hash = await listed(fields(), [B], { safe: P2 })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("hash-mismatch")
        expect(m.send).not.toHaveBeenCalled()
    })

    it("maps the send path's outcomes: declined, nothing sent, maybe sent without a hash", async () => {
        const hash = await listed(fields(), [B])
        m.send.mockResolvedValueOnce({ outcome: "cancelled", error: "You rejected it. Nothing was sent." })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("declined")
        m.send.mockResolvedValueOnce({ outcome: "failed", error: "There is no contract at 0x… on Base Sepolia. Nothing was sent." })
        const failed = await executeSafeTx("base-sepolia", "https://api.test", SAFE, hash).catch((e) => e)
        expect(failed.reason).toEqual({ code: "failed", detail: "There is no contract at 0x… on Base Sepolia" })
        m.send.mockResolvedValueOnce({ outcome: "unknown", error: "Your wallet answered without a hash" })
        const unknown = await executeSafeTx("base-sepolia", "https://api.test", SAFE, hash).catch((e) => e)
        expect(unknown.reason.detail).toMatch(/may have been sent: check your wallet/)
        expect(m.receipt).not.toHaveBeenCalled()
    })

    it("keeps the sent hash when the receipt doesn't come, and needs the Safe's ExecutionSuccess for this hash", async () => {
        const hash = await listed(fields(), [B])
        m.receipt.mockRejectedValueOnce(new Error("timeout"))
        const onSent = vi.fn()
        const err = await executeSafeTx("base-sepolia", "https://api.test", SAFE, hash, onSent).catch((e) => e)
        expect(onSent).toHaveBeenCalledWith(SENT)
        expect(err.reason).toEqual({ code: "unconfirmed", hash: SENT })
        m.receipt.mockResolvedValueOnce({ status: "reverted", logs: [] })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("reverted")
        m.receipt.mockResolvedValueOnce({ status: "success", logs: [] })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("reverted")
        m.receipt.mockResolvedValueOnce(successReceipt(`0x${"12".repeat(32)}`))
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("reverted")
        // An ExecutionSuccess for this hash from another contract doesn't count.
        m.receipt.mockResolvedValueOnce({ status: "success", logs: [{ address: P2, topics: [EXECUTION_SUCCESS, hash], data: `0x${"00".repeat(32)}` }] })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("reverted")
        m.receipt.mockResolvedValueOnce({ status: "success", logs: [{ address: SAFE, topics: [EXECUTION_SUCCESS], data: `${hash}${"00".repeat(32)}` }] })
        expect(await code(executeSafeTx("base-sepolia", "https://api.test", SAFE, hash))).toBe("ok")
    })
})
