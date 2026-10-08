import { describe, expect, it } from "vitest"
import { hashTypedData, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { checkQueuedTx, confirmationSigner, safeTxHash, type QueuedSafeTx } from "./verify"

const A = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000a11")
const B = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000b0b")
const C = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000ca1")
const SAFE = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const CHAIN = 84532

const fields = {
    safe: SAFE, to: "0x1111111111111111111111111111111111111111", value: "1000", data: null, operation: 0,
    safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: "0x0000000000000000000000000000000000000000", refundReceiver: null, nonce: "3",
}

/** The hash as the Safe contract defines it, built independently from the field list. */
const expected = hashTypedData({
    domain: { chainId: CHAIN, verifyingContract: SAFE },
    types: { SafeTx: [
        { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
    ] },
    primaryType: "SafeTx",
    message: { to: fields.to, value: 1000n, data: "0x", operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: fields.gasToken, refundReceiver: fields.gasToken, nonce: 3n },
})

async function typedSig(account: typeof A, hash: Hex): Promise<string> {
    return account.sign({ hash })
}

/** An eth_sign confirmation: a personal-message signature over the hash, with v + 4 as Safe expects. */
async function ethSignSig(account: typeof A, hash: Hex): Promise<string> {
    const raw = await account.signMessage({ message: { raw: hash } })
    return `${raw.slice(0, 130)}${(parseInt(raw.slice(130), 16) + 4).toString(16)}`
}

describe("checking a queued Safe transaction", () => {
    it("recomputes the safeTxHash from the fields", () => {
        expect(safeTxHash(CHAIN, { ...fields, safeTxHash: "0x" } as QueuedSafeTx)).toBe(expected)
    })

    it("verifies EIP-712 and eth_sign confirmations by their owners; contract signatures stay unverified", async () => {
        const tx: QueuedSafeTx = {
            ...fields, safeTxHash: expected.toUpperCase().replace("0X", "0x"),
            confirmations: [
                { owner: A.address, signature: await typedSig(A, expected) },
                { owner: B.address.toLowerCase(), signature: await ethSignSig(B, expected) },
                { owner: C.address, signature: `0x${"00".repeat(64)}00` },
            ],
        }
        const check = await checkQueuedTx(CHAIN, [A.address, B.address, C.address], tx)
        expect(check.hashMatches).toBe(true)
        expect([...check.submitted]).toEqual([A.address, B.address, C.address].map((a) => a.toLowerCase()))
        expect([...check.verified]).toEqual([A.address, B.address].map((a) => a.toLowerCase()))
    })

    it("does not verify a signature made by someone else than the owner it names, nor count a non-owner", async () => {
        const tx: QueuedSafeTx = {
            ...fields, safeTxHash: expected,
            confirmations: [
                { owner: A.address, signature: await typedSig(B, expected) },
                { owner: C.address, signature: await typedSig(C, expected) },
            ],
        }
        const check = await checkQueuedTx(CHAIN, [A.address, B.address], tx)
        expect([...check.submitted]).toEqual([A.address.toLowerCase()])
        expect(check.verified.size).toBe(0)
    })

    it("verifies nothing when the listed hash does not describe the listed fields", async () => {
        const tx: QueuedSafeTx = { ...fields, value: "1001", safeTxHash: expected, confirmations: [{ owner: A.address, signature: await typedSig(A, expected) }] }
        const check = await checkQueuedTx(CHAIN, [A.address], tx)
        expect(check).toMatchObject({ hashMatches: false })
        expect(check.verified.size).toBe(0)
        expect(check.submitted.size).toBe(1)
        expect((await checkQueuedTx(CHAIN + 1, [A.address], { ...tx, value: "1000" })).hashMatches).toBe(false)
        // Signatures over the real fields, under a listed hash that is not theirs: still nothing verified.
        const listedElsewhere: QueuedSafeTx = { ...fields, safeTxHash: `0x${"00".repeat(32)}`, confirmations: [{ owner: A.address, signature: await typedSig(A, expected) }] }
        expect((await checkQueuedTx(CHAIN, [A.address], listedElsewhere)).verified.size).toBe(0)
    })

    it("reads no signer from a malformed or on-chain-approval signature", async () => {
        expect(await confirmationSigner(expected, "0x1234")).toBeNull()
        expect(await confirmationSigner(expected, `0x${"00".repeat(64)}01`)).toBeNull()
        expect((await checkQueuedTx(CHAIN, [A.address], { ...fields, nonce: "x", safeTxHash: expected })).hashMatches).toBe(false)
    })
})
