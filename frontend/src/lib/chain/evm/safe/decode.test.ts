import { describe, expect, it } from "vitest"
import { encodeFunctionData, encodePacked, erc20Abi, maxUint256, parseAbi, size, type Hex } from "viem"
import { decodeSafeTx, type SafeTxFields } from "./decode"

const SAFE: Hex = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const ALICE: Hex = "0xa11ce00000000000000000000000000000000001"
const BOB: Hex = "0xb0b0000000000000000000000000000000000002"
const TOKEN: Hex = "0x7070000000000000000000000000000000000003"
const MULTISEND_150: Hex = "0x218543288004CD07832472D464648173c77D7eB7"
const CALL_ONLY_150: Hex = "0xA83c336B20401Af773B6219BA5027174338D1836"

const SAFE_ADMIN = parseAbi([
    "function addOwnerWithThreshold(address owner, uint256 threshold)",
    "function removeOwner(address prevOwner, address owner, uint256 threshold)",
    "function swapOwner(address prevOwner, address oldOwner, address newOwner)",
    "function changeThreshold(uint256 threshold)",
    "function enableModule(address module)",
    "function disableModule(address prevModule, address module)",
    "function setGuard(address guard)",
    "function setModuleGuard(address moduleGuard)",
    "function setFallbackHandler(address handler)",
    "function changeMasterCopy(address masterCopy)",
    "function multiSend(bytes transactions)",
])

const call = (to: string, data: Hex = "0x", value: string | bigint = "0"): SafeTxFields => ({ to, value, data, operation: 0 })
const transfer = (to: Hex, amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] })

/** MultiSend's packed encoding, built independently with viem. */
function multiSend(txs: { operation: number; to: Hex; value: bigint; data: Hex }[]): Hex {
    const packed = txs.map((t) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [t.operation, t.to, t.value, BigInt(size(t.data)), t.data]))
    return encodeFunctionData({ abi: SAFE_ADMIN, functionName: "multiSend", args: [`0x${packed.map((p) => p.slice(2)).join("")}`] })
}

describe("decoding a Safe transaction", () => {
    it("names a plain ETH payment, and a payment to the Safe itself as a caution", () => {
        expect(decodeSafeTx(SAFE, call(ALICE, "0x", "1500000000000000000"))).toEqual({ kind: "native-transfer", to: ALICE, value: 1500000000000000000n, severity: "normal" })
        expect(decodeSafeTx(SAFE, { ...call(ALICE), data: null, value: 5n })).toMatchObject({ kind: "native-transfer", value: 5n })
        expect(decodeSafeTx(SAFE, call(SAFE, "0x", "1")).severity).toBe("caution")
    })

    it("names an empty call to the Safe as a no-op (a rejection), and an empty call elsewhere as a caution", () => {
        expect(decodeSafeTx(SAFE, call(SAFE))).toEqual({ kind: "no-op", to: SAFE, severity: "normal" })
        expect(decodeSafeTx(SAFE, call(ALICE))).toEqual({ kind: "no-op", to: ALICE, severity: "caution" })
    })

    it("reads an ERC-20 transfer and approval from their calldata", () => {
        expect(decodeSafeTx(SAFE, call(TOKEN, transfer(BOB, 42n)))).toEqual({ kind: "erc20-transfer", token: TOKEN, to: BOB, amount: 42n, severity: "normal" })
        const approve = (n: bigint) => decodeSafeTx(SAFE, call(TOKEN, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [BOB, n] })))
        expect(approve(maxUint256)).toEqual({ kind: "erc20-approve", token: TOKEN, spender: BOB, amount: maxUint256, unlimited: true, severity: "caution" })
        expect(approve(10n)).toMatchObject({ unlimited: false, severity: "caution" })
        expect(approve(0n).severity).toBe("normal")
        // A transfer that also sends ETH, or carries extra bytes, is not dressed as a plain token transfer.
        expect(decodeSafeTx(SAFE, call(TOKEN, transfer(BOB, 1n), "1")).kind).toBe("contract-call")
        expect(decodeSafeTx(SAFE, call(TOKEN, `${transfer(BOB, 1n)}00` as Hex)).kind).toBe("contract-call")
    })

    it("marks every call that changes who controls the Safe as danger, with its arguments", () => {
        const setting = (functionName: string, args: readonly unknown[]) =>
            decodeSafeTx(SAFE, call(SAFE, encodeFunctionData({ abi: SAFE_ADMIN, functionName, args } as Parameters<typeof encodeFunctionData>[0])))
        expect(setting("addOwnerWithThreshold", [ALICE, 2n])).toEqual({ kind: "safe-setting", setting: "addOwnerWithThreshold", addresses: [ALICE], threshold: 2n, severity: "danger" })
        expect(setting("removeOwner", [ALICE, BOB, 1n])).toMatchObject({ setting: "removeOwner", addresses: [ALICE, BOB], threshold: 1n })
        expect(setting("swapOwner", [ALICE, BOB, TOKEN])).toMatchObject({ setting: "swapOwner", addresses: [ALICE, BOB, TOKEN] })
        expect(setting("changeThreshold", [3n])).toMatchObject({ setting: "changeThreshold", addresses: [], threshold: 3n })
        for (const name of ["enableModule", "setGuard", "setModuleGuard", "setFallbackHandler", "changeMasterCopy"]) {
            expect(setting(name, [BOB])).toEqual({ kind: "safe-setting", setting: name, addresses: [BOB], severity: "danger" })
        }
        expect(setting("disableModule", [ALICE, BOB])).toMatchObject({ setting: "disableModule", addresses: [ALICE, BOB] })
        // The same selector sent to another contract is just a contract call.
        expect(decodeSafeTx(SAFE, call(BOB, encodeFunctionData({ abi: SAFE_ADMIN, functionName: "enableModule", args: [ALICE] }))))
            .toMatchObject({ kind: "contract-call", to: BOB, selector: "0x610b5925", severity: "caution" })
    })

    it("refuses any delegatecall except a known MultiSend batch", () => {
        expect(decodeSafeTx(SAFE, { to: BOB, value: "0", data: "0x12345678", operation: 1 })).toEqual({ kind: "delegatecall", to: BOB, data: "0x12345678", severity: "danger" })
        expect(decodeSafeTx(SAFE, { to: MULTISEND_150, value: "0", data: "0x12345678", operation: 1 }).kind).toBe("delegatecall")
        expect(decodeSafeTx(SAFE, { to: MULTISEND_150, value: "1", data: multiSend([{ operation: 0, to: ALICE, value: 1n, data: "0x" }]), operation: 1 }).kind).toBe("delegatecall")
    })

    it("opens a MultiSendCallOnly batch and grades it by its worst call", () => {
        const data = multiSend([
            { operation: 0, to: ALICE, value: 10n, data: "0x" },
            { operation: 0, to: TOKEN, value: 0n, data: transfer(BOB, 7n) },
        ])
        expect(decodeSafeTx(SAFE, { to: CALL_ONLY_150, value: "0", data, operation: 1 })).toEqual({
            kind: "batch", via: "multiSendCallOnly", severity: "normal",
            calls: [
                { kind: "native-transfer", to: ALICE, value: 10n, severity: "normal" },
                { kind: "erc20-transfer", token: TOKEN, to: BOB, amount: 7n, severity: "normal" },
            ],
        })
        const withSetting = multiSend([
            { operation: 0, to: ALICE, value: 1n, data: "0x" },
            { operation: 0, to: SAFE, value: 0n, data: encodeFunctionData({ abi: SAFE_ADMIN, functionName: "changeThreshold", args: [1n] }) },
        ])
        expect(decodeSafeTx(SAFE, { to: CALL_ONLY_150, value: "0", data: withSetting, operation: 1 }).severity).toBe("danger")
    })

    it("marks a delegatecall inside a full MultiSend batch as danger, and refuses one inside a call-only batch", () => {
        const data = multiSend([{ operation: 1, to: BOB, value: 0n, data: "0xdeadbeef" }])
        const full = decodeSafeTx(SAFE, { to: MULTISEND_150, value: "0", data, operation: 1 })
        expect(full).toMatchObject({ kind: "batch", via: "multiSend", severity: "danger", calls: [{ kind: "delegatecall", to: BOB }] })
        expect(decodeSafeTx(SAFE, { to: CALL_ONLY_150, value: "0", data, operation: 1 })).toMatchObject({ kind: "undecodable", severity: "danger" })
        // A nested batch is not opened: it would run as the Safe.
        const nested = multiSend([{ operation: 1, to: MULTISEND_150, value: 0n, data: multiSend([{ operation: 0, to: ALICE, value: 1n, data: "0x" }]) }])
        expect(decodeSafeTx(SAFE, { to: MULTISEND_150, value: "0", data: nested, operation: 1 })).toMatchObject({ severity: "danger", calls: [{ kind: "delegatecall" }] })
    })

    it("does not run a plain call to MultiSend as a batch", () => {
        const data = multiSend([{ operation: 0, to: ALICE, value: 1n, data: "0x" }])
        expect(decodeSafeTx(SAFE, call(MULTISEND_150, data))).toMatchObject({ kind: "contract-call", severity: "caution" })
    })

    it("turns malformed input into an undecodable danger instead of guessing", () => {
        const good = multiSend([{ operation: 0, to: ALICE, value: 1n, data: "0xabcdef" }])
        const truncated = good.slice(0, good.length - 8) as Hex
        for (const tx of [
            { to: CALL_ONLY_150, value: "0", data: truncated, operation: 1 },
            { to: CALL_ONLY_150, value: "0", data: multiSend([]), operation: 1 },
            { to: ALICE, value: "0", data: "0xzz", operation: 0 },
            { to: ALICE, value: "0", data: "0x123", operation: 0 },
            { to: ALICE, value: "0", data: "0x1234", operation: 0 },
            { to: ALICE, value: "-1", data: "0x", operation: 0 },
            { to: ALICE, value: "0", data: "0x", operation: 2 },
            { to: "0x1234", value: "0", data: "0x", operation: 0 },
            { to: SAFE, value: "0", data: `${encodeFunctionData({ abi: SAFE_ADMIN, functionName: "setGuard", args: [BOB] })}00`, operation: 0 },
        ] as SafeTxFields[]) {
            expect(decodeSafeTx(SAFE, tx)).toMatchObject({ kind: "undecodable", severity: "danger" })
        }
        expect(decodeSafeTx(SAFE, { to: ALICE, value: "0", data: "0xzz", operation: 0 })).toMatchObject({ to: ALICE, data: "0x" })
    })
})
