/**
 * sessionTx.ts — build and sign a session-signed `vm/exec` (MsgCall) tx for a
 * gno account session (tm2 auth sessions, gno #5307). Pure: no I/O.
 *
 * Wire format matches tm2-js-client 3.3.0 byte-for-byte (sessionTx.test.ts
 * pins it against a fixture that onyx-1 accepted). The signature is made over
 * the SESSION account's account_number/sequence and carries session_addr; the
 * tx signer (MsgCall.caller) is the master account.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { ripemd160 } from "@noble/hashes/legacy.js"
import { bech32Encode } from "./dao/realmAddress"

export interface CallMsg { caller: string; send: string; max_deposit: string; pkg_path: string; func: string; args: string[] }
export interface SessionKey { priv: Uint8Array; pub: Uint8Array; address: string; gpub: string }

// ── protobuf (proto3) helpers ────────────────────────────────────────────
const enc = new TextEncoder()
function varint(n: bigint): number[] {
    const out: number[] = []
    while (n > 127n) { out.push(Number(n & 127n) | 128); n >>= 7n }
    out.push(Number(n))
    return out
}
const bytesField = (n: number, b: Uint8Array | number[]) => [n * 8 + 2, ...varint(BigInt(b.length)), ...b]
const strField = (n: number, s: string) => (s === "" ? [] : bytesField(n, [...enc.encode(s)]))
const anyMsg = (typeUrl: string, value: number[]) => [...strField(1, typeUrl), ...bytesField(2, value)]

export function pubKeyAnyBytes(pub: Uint8Array): Uint8Array {
    return Uint8Array.from(anyMsg("/tm.PubKeySecp256k1", bytesField(1, pub)))
}

export function keyFromPriv(priv: Uint8Array): SessionKey {
    const pub = secp256k1.getPublicKey(priv, true)
    return { priv, pub, address: bech32Encode("g", ripemd160(sha256(pub))), gpub: bech32Encode("gpub", pubKeyAnyBytes(pub)) }
}

export function newSessionKey(): SessionKey {
    return keyFromPriv(secp256k1.utils.randomSecretKey())
}

// ── sign payload ─────────────────────────────────────────────────────────
// Every string we sign is drawn from this set, so JSON.stringify renders it
// exactly as Go's amino JSON does (no HTML escaping or unicode to diverge on).
const SAFE = /^[A-Za-z0-9 :/._-]*$/

function sortKeys(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
    return v
}

export function signPayload(p: { chainId: string; accountNumber: string; sequence: string; gas: number; feeUgnot: number; memo: string; msg: CallMsg }): string {
    const { msg } = p
    if (msg.args.length === 0) throw new Error("sessionTx: a call needs at least one arg")
    const strings = [p.chainId, p.memo, msg.caller, msg.send, msg.max_deposit, msg.pkg_path, msg.func, ...msg.args]
    if (!strings.every((s) => SAFE.test(s))) throw new Error("sessionTx: unsupported characters in tx fields")
    if (!/^\d+$/.test(p.accountNumber) || !/^\d+$/.test(p.sequence)) throw new Error("sessionTx: bad account number or sequence")
    if (!Number.isSafeInteger(p.gas) || p.gas <= 0 || !Number.isSafeInteger(p.feeUgnot) || p.feeUgnot < 0) throw new Error("sessionTx: bad fee")
    return JSON.stringify(sortKeys({
        account_number: p.accountNumber,
        chain_id: p.chainId,
        fee: { amount: p.feeUgnot === 0 ? [] : [{ amount: String(p.feeUgnot), denom: "ugnot" }], gas: String(p.gas) },
        memo: p.memo,
        msgs: [{ "@type": "/vm.m_call", args: msg.args, caller: msg.caller, func: msg.func, max_deposit: msg.max_deposit, pkg_path: msg.pkg_path, send: msg.send }],
        sequence: p.sequence,
    }))
}

// ── tx encoding ──────────────────────────────────────────────────────────
function encodeMsgCall(m: CallMsg): number[] {
    return [...strField(1, m.caller), ...strField(2, m.send), ...strField(3, m.max_deposit), ...strField(4, m.pkg_path), ...strField(5, m.func),
        ...m.args.flatMap((a) => bytesField(6, [...enc.encode(a)]))]
}

export function signSessionTx(p: { key: SessionKey; chainId: string; accountNumber: string; sequence: string; gas: number; feeUgnot: number; memo: string; msg: CallMsg }): Uint8Array {
    // signPayload renders 0 as an empty amount list but the tx would carry "0ugnot"
    if (p.feeUgnot <= 0) throw new Error("sessionTx: session txs need a positive fee")
    const payload = signPayload(p)
    const sig = secp256k1.sign(sha256(enc.encode(payload)), p.key.priv, { prehash: false })
    const zigzagGas = (BigInt(p.gas) << 1n) ^ (BigInt(p.gas) >> 63n)
    const fee = [8, ...varint(zigzagGas), ...strField(2, `${p.feeUgnot}ugnot`)]
    const signature = [...bytesField(1, [...pubKeyAnyBytes(p.key.pub)]), ...bytesField(2, [...sig]), ...strField(3, p.key.address)]
    return Uint8Array.from([
        ...bytesField(1, anyMsg("/vm.m_call", encodeMsgCall(p.msg))),
        ...bytesField(2, fee),
        ...bytesField(3, signature),
        ...strField(4, p.memo),
    ])
}
