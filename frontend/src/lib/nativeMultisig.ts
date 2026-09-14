import { secp256k1 } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { ripemd160 } from "@noble/hashes/legacy.js"
import { bech32Encode } from "./dao/realmAddress"

export const NATIVE_MULTISIG_TYPE = "/tm.PubKeyMultisig"
export function nativeFeeJSON(gas: string, feeUgnot: string): string {
    if (!/^[1-9][0-9]*$/.test(gas) || !/^[1-9][0-9]*$/.test(feeUgnot) || BigInt(gas) > (1n << 60n) - 1n || BigInt(feeUgnot) > (1n << 63n) - 1n) throw new Error("Review a valid native gas limit and fee in ugnot")
    return JSON.stringify({ gas_wanted: gas, gas_fee: `${feeUgnot}ugnot` })
}
export interface NativeKey { "@type": "/tm.PubKeySecp256k1"; value: string }
export interface NativeMultisig { "@type": typeof NATIVE_MULTISIG_TYPE; threshold: string; pubkeys: NativeKey[] }

export function decodeMemberKey(value: string): Uint8Array {
    const raw = Uint8Array.from(atob(value), c => c.charCodeAt(0))
    if (raw.length !== 33 || btoa(String.fromCharCode(...raw)) !== value) throw new Error("Expected a canonical base64 compressed secp256k1 public key")
    secp256k1.Point.fromBytes(raw).assertValidity()
    return raw
}

export function memberAddress(value: string, prefix = "g"): string {
    return bech32Encode(prefix, ripemd160(sha256(decodeMemberKey(value))))
}

export function isNativeMultisig(raw: string): boolean {
    try { const v: unknown = JSON.parse(raw); return !!v && typeof v === "object" && "@type" in v } catch { return false }
}

export function parseNativeMultisig(raw: string): NativeMultisig {
    if (raw.length > 4096) throw new Error("Multisig configuration is too large")
    const v = JSON.parse(raw) as NativeMultisig
    if (!v || v["@type"] !== NATIVE_MULTISIG_TYPE || Object.keys(v).sort().join() !== "@type,pubkeys,threshold" || !Array.isArray(v.pubkeys)) throw new Error("Expected a native Gno multisig public key")
    const k = Number(v.threshold)
    if (!Number.isInteger(k) || k < 1 || k > v.pubkeys.length || String(k) !== v.threshold || v.pubkeys.length > 7) throw new Error("Threshold must be an integer between 1 and the member count (maximum 7)")
    const seen = new Set<string>()
    for (const p of v.pubkeys) {
        if (!p || p["@type"] !== "/tm.PubKeySecp256k1" || Object.keys(p).sort().join() !== "@type,value") throw new Error("Only compressed secp256k1 member keys are supported")
        decodeMemberKey(p.value)
        if (seen.has(p.value)) throw new Error("Duplicate member public key")
        seen.add(p.value)
    }
    return v // Imported order is identity, never sort here.
}

function varint(n: number): number[] {
    const result: number[] = []
    do { result.push((n & 127) | (n > 127 ? 128 : 0)); n = Math.floor(n / 128) } while (n)
    return result
}
function field(n: number, bytes: Uint8Array | number[]): number[] { return [n * 8 + 2, ...varint(bytes.length), ...bytes] }
function any(type: string, bytes: number[]): number[] { return [...field(1, new TextEncoder().encode(type)), ...field(2, bytes)] }

// The tiny encoding surface is pinned by independent native-node byte/address
// vectors. This is Gno protobuf Any, NOT Cosmos LegacyAminoPubKey encoding.
export function nativePreimage(pk: NativeMultisig): Uint8Array {
    const checked = parseNativeMultisig(JSON.stringify(pk))
    return Uint8Array.from(any(NATIVE_MULTISIG_TYPE, [8, ...varint(Number(checked.threshold)), ...checked.pubkeys.flatMap(p => field(2, any(p["@type"], field(1, decodeMemberKey(p.value)))))]))
}
export function nativeAddress(pk: NativeMultisig): string { return bech32Encode("g", sha256(nativePreimage(pk)).slice(0, 20)) }

export function createNativeMultisig(members: { address: string; pubkeyValue: string }[], threshold: number): NativeMultisig {
    const sorted = members.map(m => {
        if (memberAddress(m.pubkeyValue) !== m.address.trim()) throw new Error("A member address does not match its public key")
        return { key: m.pubkeyValue, addressBytes: ripemd160(sha256(decodeMemberKey(m.pubkeyValue))) }
    }).sort((a, b) => {
        for (let i = 0; i < 20; i++) { if (a.addressBytes[i] !== b.addressBytes[i]) return a.addressBytes[i] - b.addressBytes[i] }
        return 0
    })
    return parseNativeMultisig(JSON.stringify({ "@type": NATIVE_MULTISIG_TYPE, threshold: String(threshold), pubkeys: sorted.map(m => ({ "@type": "/tm.PubKeySecp256k1", value: m.key })) }))
}
