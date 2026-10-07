import { beforeEach, describe, expect, it, vi } from "vitest"
import { encodeFunctionData, encodePacked, parseAbi, size, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { SafeActionError } from "./create"
import { assertBuilt, confirmSafeTx, executeSafeTx, proposeSafeTx, type SafeCall } from "./transact"
import { safeTxHash } from "./verify"

const mocks = vi.hoisted(() => ({
    client: { account: { address: "" } },
    kit: { getNonce: vi.fn(), createTransaction: vi.fn(), getTransactionHash: vi.fn(), signTransaction: vi.fn(), toSafeTransactionType: vi.fn(), executeTransaction: vi.fn() },
    service: { getNextNonce: vi.fn(), proposeTransaction: vi.fn(), getTransaction: vi.fn(), confirmTransaction: vi.fn() },
    receipt: vi.fn(),
}))
vi.mock("@wagmi/core", async (orig) => ({
    ...(await orig<typeof import("@wagmi/core")>()),
    getConnectorClient: async () => mocks.client,
    waitForTransactionReceipt: mocks.receipt,
}))
vi.mock("@safe-global/protocol-kit", () => ({ default: { init: async () => mocks.kit } }))
vi.mock("./txService", () => ({ safeApiKit: () => mocks.service }))

const CHAIN = 84532
const SAFE: Hex = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const A = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000a11")
const B = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000b0b")
const C = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000ca1")
const owners = [A, B, C].map((x) => x.address.toLowerCase() as Hex)
const CALL_ONLY: Hex = "0xA83c336B20401Af773B6219BA5027174338D1836"
const FULL_MULTISEND: Hex = "0x218543288004CD07832472D464648173c77D7eB7"
const ZERO: Hex = "0x0000000000000000000000000000000000000000"
const P1: Hex = "0x1111111111111111111111111111111111111111"
const P2: Hex = "0x2222222222222222222222222222222222222222"

const pay = (to: Hex, value: bigint): SafeCall => ({ to, value, data: "0x" })
const fields = (over: object = {}) => ({ to: P1, value: "5", data: "0x", operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: ZERO, refundReceiver: ZERO, nonce: 3, ...over })
function batch(calls: { operation?: number; to: Hex; value: bigint; data: Hex }[]): Hex {
    const packed = calls.map((t) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [t.operation ?? 0, t.to, t.value, BigInt(size(t.data)), t.data]))
    return encodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions)"]), functionName: "multiSend", args: [`0x${packed.map((p) => p.slice(2)).join("")}`] })
}
function refusal(tx: ReturnType<typeof fields>, calls: SafeCall[]): string {
    try { assertBuilt(tx, calls) } catch (err) { return err instanceof SafeActionError && err.reason.code === "unexpected-transaction" ? err.reason.detail : String(err) }
    return "accepted"
}

describe("checking a built Safe transaction before signing", () => {
    it("accepts exactly one asked call, or a call-only batch of exactly the asked calls", () => {
        expect(refusal(fields(), [pay(P1, 5n)])).toBe("accepted")
        const calls = [pay(P1, 1n), pay(P2, 2n)]
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: batch(calls) }), calls)).toBe("accepted")
    })

    it("refuses another call, value, operation, a refund, a full MultiSend, or a batch that differs", () => {
        expect(refusal(fields({ value: "6" }), [pay(P1, 5n)])).toBe("not the call asked for")
        expect(refusal(fields({ to: P2 }), [pay(P1, 5n)])).toBe("not the call asked for")
        expect(refusal(fields({ operation: 1 }), [pay(P1, 5n)])).toBe("not the call asked for")
        expect(refusal(fields({ data: "0x12" }), [pay(P1, 5n)])).toBe("not the call asked for")
        for (const over of [{ gasPrice: "1" }, { safeTxGas: "1" }, { baseGas: "1" }, { gasToken: P2 }, { refundReceiver: P2 }]) expect(refusal(fields(over), [pay(P1, 5n)])).toBe("a gas refund is included")
        const calls = [pay(P1, 1n), pay(P2, 2n)]
        expect(refusal(fields({ to: FULL_MULTISEND, value: "0", operation: 1, data: batch(calls) }), calls)).toBe("not a call-only batch")
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: batch([calls[1], calls[0]]) }), calls)).toBe("not the calls asked for")
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: batch([calls[0]]) }), calls)).toBe("not the calls asked for")
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: batch([{ ...calls[0], operation: 1 }, calls[1]]) }), calls)).toBe("not the calls asked for")
        expect(refusal(fields({ to: CALL_ONLY, value: "0", operation: 1, data: "0x8d80ff0a00" }), calls)).toBe("an unreadable batch")
        expect(refusal(fields(), [])).toBe("no call")
    })
})

function reason(p: Promise<unknown>): Promise<string> {
    return p.then(() => "ok", (err) => (err instanceof SafeActionError ? err.reason.code : `other: ${String(err)}`))
}

const hashOf = (f: ReturnType<typeof fields>) => safeTxHash(CHAIN, { ...f, safe: SAFE, safeTxHash: "" })

describe("proposing, signing and executing", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.client.account.address = A.address
        mocks.service.getNextNonce.mockResolvedValue("3")
        mocks.kit.createTransaction.mockImplementation(async () => ({ data: fields() }))
        mocks.kit.getTransactionHash.mockImplementation(async (tx: { data: ReturnType<typeof fields> }) => hashOf(tx.data))
        mocks.kit.signTransaction.mockImplementation(async (tx: { data: ReturnType<typeof fields> }) => ({ ...tx, getSignature: () => ({ data: "0xsig" }) }))
        mocks.kit.toSafeTransactionType.mockImplementation(async (tx: ReturnType<typeof fields>) => ({ data: tx }))
        mocks.kit.executeTransaction.mockResolvedValue({ hash: `0x${"ee".repeat(32)}` })
        mocks.receipt.mockResolvedValue({ status: "success" })
    })

    it("proposes at the service's next nonce with the owner's signature and Memba's own hash", async () => {
        const hash = await proposeSafeTx("base-sepolia", "https://api.test", SAFE, owners, [pay(P1, 5n)])
        expect(hash).toBe(hashOf(fields()))
        expect(mocks.kit.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ onlyCalls: true, options: { nonce: 3 } }))
        expect(mocks.service.proposeTransaction).toHaveBeenCalledWith(expect.objectContaining({ safeTxHash: hash, senderAddress: A.address, senderSignature: "0xsig", origin: "Memba" }))
    })

    it("refuses to propose for a wallet that isn't an owner, or when protocol-kit's hash isn't Memba's", async () => {
        mocks.client.account.address = "0x9999999999999999999999999999999999999999"
        expect(await reason(proposeSafeTx("base-sepolia", "https://api.test", SAFE, owners, [pay(P1, 5n)]))).toBe("not-owner")
        mocks.client.account.address = A.address
        mocks.kit.getTransactionHash.mockResolvedValue(`0x${"00".repeat(32)}`)
        expect(await reason(proposeSafeTx("base-sepolia", "https://api.test", SAFE, owners, [pay(P1, 5n)]))).toBe("hash-mismatch")
        expect(mocks.kit.signTransaction).not.toHaveBeenCalled()
        expect(mocks.service.proposeTransaction).not.toHaveBeenCalled()
    })

    it("says what the Transaction Service refused", async () => {
        mocks.service.proposeTransaction.mockRejectedValue(new Error("Signer=0x… is not an owner or delegate"))
        const err = await proposeSafeTx("base-sepolia", "https://api.test", SAFE, owners, [pay(P1, 5n)]).catch((e) => e)
        expect(err).toBeInstanceOf(SafeActionError)
        expect(err.reason).toEqual({ code: "service", detail: "Signer=0x… is not an owner or delegate" })
    })

    async function queuedWith(signers: (typeof A)[]) {
        const f = fields()
        const hash = hashOf(f)
        const confirmations = await Promise.all(signers.map(async (s) => ({ owner: s.address, signature: await s.sign({ hash }) })))
        mocks.service.getTransaction.mockResolvedValue({ ...f, safe: SAFE, safeTxHash: hash, confirmations })
        return hash
    }

    it("confirms a listed transaction only when its hash is its own, and once", async () => {
        const hash = await queuedWith([B])
        await confirmSafeTx("base-sepolia", "https://api.test", SAFE, owners, hash)
        expect(mocks.service.confirmTransaction).toHaveBeenCalledWith(hash, "0xsig")
        await queuedWith([A])
        expect(await reason(confirmSafeTx("base-sepolia", "https://api.test", SAFE, owners, hash))).toBe("not-ready")
        mocks.service.getTransaction.mockResolvedValue({ ...fields({ value: "999" }), safe: SAFE, safeTxHash: hash, confirmations: [] })
        expect(await reason(confirmSafeTx("base-sepolia", "https://api.test", SAFE, owners, hash))).toBe("hash-mismatch")
    })

    it("executes at the on-chain nonce with enough recovered signatures, counting an owner executor once", async () => {
        const facts = { owners, threshold: 2, nonce: 3n }
        // B signed; A executes and is an owner who hasn't signed: 1 + 1 = 2.
        const hash = await queuedWith([B])
        expect(await reason(executeSafeTx("base-sepolia", "https://api.test", SAFE, facts, hash))).toBe("ok")
        // A non-owner executor adds nothing: 1 of 2.
        mocks.client.account.address = "0x9999999999999999999999999999999999999999"
        expect(await reason(executeSafeTx("base-sepolia", "https://api.test", SAFE, facts, hash))).toBe("not-ready")
        // A signature that does not recover to its owner doesn't count (C's own does; A executes: 1 + 1).
        mocks.client.account.address = A.address
        mocks.service.getTransaction.mockResolvedValue({ ...fields(), safe: SAFE, safeTxHash: hash, confirmations: [{ owner: B.address, signature: await C.sign({ hash }) }, { owner: C.address, signature: await C.sign({ hash }) }] })
        expect(await reason(executeSafeTx("base-sepolia", "https://api.test", SAFE, facts, hash))).toBe("ok")
        // Only a misattributed signature: 0 verified, A adds 1 of 2.
        mocks.service.getTransaction.mockResolvedValue({ ...fields(), safe: SAFE, safeTxHash: hash, confirmations: [{ owner: B.address, signature: await C.sign({ hash }) }] })
        expect(await reason(executeSafeTx("base-sepolia", "https://api.test", SAFE, facts, hash))).toBe("not-ready")
        // Not the Safe's next nonce.
        await queuedWith([A, B])
        expect(await reason(executeSafeTx("base-sepolia", "https://api.test", SAFE, { ...facts, nonce: 2n }, hash))).toBe("not-ready")
        // Reverted on chain.
        mocks.receipt.mockResolvedValue({ status: "reverted" })
        expect(await reason(executeSafeTx("base-sepolia", "https://api.test", SAFE, facts, hash))).toBe("reverted")
    })
})
