/**
 * What a Safe transaction does, in words a member can check before signing.
 * Any queued transaction is read this way, including ones proposed elsewhere
 * (Safe{Wallet}, scripts): it is decoded from its own fields, never from a
 * description someone attached.
 *
 * - A delegatecall runs another contract's code as the Safe. Only a known
 *   MultiSend batch is accepted; anything else is "danger".
 * - A call from the Safe to itself that changes owners, threshold, modules,
 *   guards or the fallback handler is "danger": it changes who controls it.
 * - An ERC-20 approval is "caution": it lets someone else spend the tokens.
 * - Anything Memba can't name is a "caution" contract call, shown with its data.
 *
 * No EVM library: plain hex reading (./abi), so it is tested with plain data.
 *
 * @module lib/chain/evm/safe/decode
 */
import { AbiError, body, readBytes, word, wordToAddress, wordToBigInt } from "./abi"
import { multiSendAt, type Hex, type MultiSendKind } from "./known"

export interface SafeTxFields {
    to: string
    /** Wei, as the Transaction Service gives it (a decimal string) or a bigint. */
    value: string | bigint
    data: string | null
    /** 0 = call, 1 = delegatecall. */
    operation: number
}

export type Severity = "normal" | "caution" | "danger"

export type SafeSetting =
    | "addOwnerWithThreshold" | "removeOwner" | "swapOwner" | "changeThreshold"
    | "enableModule" | "disableModule" | "setGuard" | "setModuleGuard" | "setFallbackHandler" | "changeMasterCopy"

export type DecodedTx =
    | { kind: "native-transfer"; to: Hex; value: bigint; severity: Severity }
    | { kind: "erc20-transfer"; token: Hex; to: Hex; amount: bigint; severity: Severity }
    | { kind: "erc20-approve"; token: Hex; spender: Hex; amount: bigint; unlimited: boolean; severity: Severity }
    | { kind: "safe-setting"; setting: SafeSetting; addresses: Hex[]; threshold?: bigint; severity: "danger" }
    | { kind: "no-op"; to: Hex; severity: Severity }
    | { kind: "batch"; via: MultiSendKind; calls: DecodedTx[]; severity: Severity }
    | { kind: "contract-call"; to: Hex; value: bigint; selector: Hex; data: Hex; severity: Severity }
    | { kind: "delegatecall"; to: Hex; data: Hex; severity: "danger" }
    | { kind: "undecodable"; to: Hex; data: Hex; reason: string; severity: "danger" }

const TRANSFER = "a9059cbb"
const APPROVE = "095ea7b3"
const MULTI_SEND = "8d80ff0a"
const MAX_UINT256 = (1n << 256n) - 1n

/** Selector → setting, with how many leading address arguments it takes and whether a threshold follows. */
const SETTINGS: Readonly<Record<string, { setting: SafeSetting; addresses: number; threshold: boolean }>> = {
    "0d582f13": { setting: "addOwnerWithThreshold", addresses: 1, threshold: true },
    "f8dc5dd9": { setting: "removeOwner", addresses: 2, threshold: true },
    "e318b52b": { setting: "swapOwner", addresses: 3, threshold: false },
    "694e80c3": { setting: "changeThreshold", addresses: 0, threshold: true },
    "610b5925": { setting: "enableModule", addresses: 1, threshold: false },
    "e009cfde": { setting: "disableModule", addresses: 2, threshold: false },
    "e19a9dd9": { setting: "setGuard", addresses: 1, threshold: false },
    "e068df37": { setting: "setModuleGuard", addresses: 1, threshold: false },
    "f08a0323": { setting: "setFallbackHandler", addresses: 1, threshold: false },
    "7de7edef": { setting: "changeMasterCopy", addresses: 1, threshold: false },
}

const worst = (severities: Severity[]): Severity =>
    severities.includes("danger") ? "danger" : severities.includes("caution") ? "caution" : "normal"

function address(input: string): Hex {
    const hex = body(input)
    if (hex.length !== 40) throw new AbiError("not an address")
    return `0x${hex}`
}

function wei(value: string | bigint): bigint {
    if (typeof value === "bigint") return value
    if (!/^\d{1,78}$/.test(value)) throw new AbiError("not a wei amount")
    return BigInt(value)
}

/** The arguments of a call with only static words (no dynamic data after them). */
function staticArgs(args: string, count: number): string[] {
    if (args.length !== count * 64) throw new AbiError("unexpected argument length")
    return Array.from({ length: count }, (_, i) => word(args, i))
}

/** MultiSend's packed transactions: operation (1 byte), to (20), value (32), data length (32), data. */
function unpackMultiSend(packed: string): SafeTxFields[] {
    const txs: SafeTxFields[] = []
    let at = 0
    while (at < packed.length) {
        if (at + (1 + 20 + 32 + 32) * 2 > packed.length) throw new AbiError("truncated batch entry")
        const operation = parseInt(packed.slice(at, at + 2), 16)
        const to = `0x${packed.slice(at + 2, at + 42)}`
        const value = wordToBigInt(packed.slice(at + 42, at + 106))
        const length = wordToBigInt(packed.slice(at + 106, at + 170))
        const start = at + 170
        if (length * 2n > BigInt(packed.length - start)) throw new AbiError("batch entry data past the end")
        const end = start + Number(length) * 2
        txs.push({ to, value, data: `0x${packed.slice(start, end)}`, operation })
        at = end
    }
    if (txs.length === 0) throw new AbiError("empty batch")
    return txs
}

function decodeCall(safe: Hex, to: Hex, value: bigint, data: string): DecodedTx {
    if (data.length === 0) {
        if (value > 0n) return { kind: "native-transfer", to, value, severity: to === safe ? "caution" : "normal" }
        return { kind: "no-op", to, severity: to === safe ? "normal" : "caution" }
    }
    if (data.length < 8) throw new AbiError("data shorter than a selector")
    const selector = data.slice(0, 8)
    const args = data.slice(8)
    const setting = SETTINGS[selector]
    if (to === safe && setting) {
        const words = staticArgs(args, setting.addresses + (setting.threshold ? 1 : 0))
        return {
            kind: "safe-setting", setting: setting.setting, severity: "danger",
            addresses: words.slice(0, setting.addresses).map(wordToAddress),
            ...(setting.threshold ? { threshold: wordToBigInt(words[setting.addresses]) } : {}),
        }
    }
    if (value === 0n && selector === TRANSFER && args.length === 128) {
        const [recipient, amount] = staticArgs(args, 2)
        return { kind: "erc20-transfer", token: to, to: wordToAddress(recipient), amount: wordToBigInt(amount), severity: "normal" }
    }
    if (value === 0n && selector === APPROVE && args.length === 128) {
        const [spender, amount] = staticArgs(args, 2)
        const n = wordToBigInt(amount)
        return { kind: "erc20-approve", token: to, spender: wordToAddress(spender), amount: n, unlimited: n === MAX_UINT256, severity: n === 0n ? "normal" : "caution" }
    }
    return { kind: "contract-call", to, value, selector: `0x${selector}`, data: `0x${data}`, severity: "caution" }
}

function decodeFields(safe: Hex, tx: SafeTxFields, inBatch: boolean): DecodedTx {
    const to = address(tx.to)
    const data = body(tx.data ?? "0x")
    const value = wei(tx.value)
    if (tx.operation === 0) return decodeCall(safe, to, value, data)
    if (tx.operation !== 1) throw new AbiError("unknown operation")

    const multiSend = multiSendAt(to)
    if (!multiSend || inBatch) return { kind: "delegatecall", to, data: `0x${data}`, severity: "danger" }
    if (data.slice(0, 8) !== MULTI_SEND || value !== 0n) return { kind: "delegatecall", to, data: `0x${data}`, severity: "danger" }
    const packed = readBytes(data.slice(8), 0)
    const calls = unpackMultiSend(packed).map((inner) => {
        // MultiSendCallOnly refuses an inner delegatecall on chain; full MultiSend runs it as the Safe.
        if (inner.operation !== 0 && multiSend.kind === "multiSendCallOnly") throw new AbiError("delegatecall inside a call-only batch")
        return decodeFields(safe, inner, true)
    })
    return { kind: "batch", via: multiSend.kind, calls, severity: worst(calls.map((c) => c.severity)) }
}

/** Decode one Safe transaction proposed for `safeAddress`. Never throws: malformed input is "undecodable" (danger). */
export function decodeSafeTx(safeAddress: string, tx: SafeTxFields): DecodedTx {
    try {
        return decodeFields(address(safeAddress), tx, false)
    } catch (err) {
        let to: Hex = "0x"
        let data: Hex = "0x"
        try { to = address(tx.to) } catch { /* keep 0x */ }
        try { data = `0x${body(tx.data ?? "0x")}` } catch { /* keep 0x */ }
        return { kind: "undecodable", to, data, reason: err instanceof AbiError ? err.message : "unreadable", severity: "danger" }
    }
}
