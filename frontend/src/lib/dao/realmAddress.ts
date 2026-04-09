/**
 * Derive a bech32 address from a Gno realm/package path.
 *
 * The Gno chain derives package addresses with:
 *   SHA256("pkgPath:" + realmPath) → take first 20 bytes → bech32 encode with "g" prefix
 *
 * Example:
 *   derivePkgBech32Addr("gno.land/r/gov/dao/v2") → "g1p84dvfh4wrplyxx4zsmy77a8rxcnjup2j7zv5r"
 *
 * @module lib/dao/realmAddress
 */

/**
 * Derive the bech32 address for a Gno package/realm path.
 * Uses Web Crypto API (zero deps, built into all modern browsers).
 */
export async function derivePkgBech32Addr(realmPath: string, hrp = "g"): Promise<string> {
    const prefix = "pkgPath:"
    const data = new TextEncoder().encode(prefix + realmPath)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashBytes = new Uint8Array(hashBuffer).slice(0, 20)
    return bech32Encode(hrp, hashBytes)
}

// ── Bech32 encoding (BIP173) ─────────────────────────────────

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

function bech32Polymod(values: number[]): number {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    let chk = 1
    for (const v of values) {
        const b = chk >> 25
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for (let i = 0; i < 5; i++) {
            chk ^= (b >> i) & 1 ? GEN[i] : 0
        }
    }
    return chk
}

function bech32HrpExpand(hrp: string): number[] {
    const ret: number[] = []
    for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5)
    ret.push(0)
    for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31)
    return ret
}

function bech32Checksum(hrp: string, data: number[]): number[] {
    const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0])
    const polymod = bech32Polymod(values) ^ 1
    const ret: number[] = []
    for (let i = 0; i < 6; i++) {
        ret.push((polymod >> (5 * (5 - i))) & 31)
    }
    return ret
}

/**
 * Convert bytes to 5-bit groups (bech32 data encoding).
 */
function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
    let acc = 0
    let bits = 0
    const ret: number[] = []
    const maxv = (1 << toBits) - 1

    for (const value of data) {
        acc = (acc << fromBits) | value
        bits += fromBits
        while (bits >= toBits) {
            bits -= toBits
            ret.push((acc >> bits) & maxv)
        }
    }

    if (pad) {
        if (bits > 0) {
            ret.push((acc << (toBits - bits)) & maxv)
        }
    }

    return ret
}

/**
 * Encode bytes as a bech32 string.
 */
export function bech32Encode(hrp: string, data: Uint8Array): string {
    const data5bit = convertBits(data, 8, 5, true)
    const checksum = bech32Checksum(hrp, data5bit)
    return hrp + "1" + data5bit.concat(checksum).map(d => BECH32_CHARSET[d]).join("")
}

/**
 * Derive a bech32 address from a base64-encoded secp256k1 public key.
 *
 * Gno address derivation: SHA256(pubkey_bytes) → first 20 bytes → bech32 encode.
 * This matches Gno's tm2 crypto (truncated SHA256, no RIPEMD160).
 */
export async function pubkeyToAddress(base64Pubkey: string, hrp = "g"): Promise<string> {
    const pubkeyBytes = Uint8Array.from(atob(base64Pubkey), c => c.charCodeAt(0))
    const hashBuffer = await crypto.subtle.digest("SHA-256", pubkeyBytes)
    const addressBytes = new Uint8Array(hashBuffer).slice(0, 20)
    return bech32Encode(hrp, addressBytes)
}

/**
 * Convert a hex address (20 bytes) to bech32.
 * Used to convert Tendermint consensus hex addresses to g1... addresses
 * for matching against gnomonitoring data.
 *
 * Example: hexToBech32("A1B2C3...", "g") → "g1..."
 */
export function hexToBech32(hexAddr: string, hrp = "g"): string {
    const bytes = new Uint8Array(hexAddr.length / 2)
    for (let i = 0; i < hexAddr.length; i += 2) {
        bytes[i / 2] = parseInt(hexAddr.substring(i, i + 2), 16)
    }
    return bech32Encode(hrp, bytes)
}
