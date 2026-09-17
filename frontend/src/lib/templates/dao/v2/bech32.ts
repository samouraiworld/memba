/**
 * Minimal bech32 (BIP-173) checksum helpers for Gno account addresses.
 *
 * The generated DAO realm checks `address.IsValid()` at genesis, which verifies
 * the bech32 checksum and a 20-byte payload. The generator checks the same thing
 * up front so a mistyped member address is refused in the wizard instead of
 * producing a package that can never initialise.
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
    let chk = 1
    for (const v of values) {
        const top = chk >>> 25
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for (let i = 0; i < 5; i++) {
            if ((top >>> i) & 1) chk ^= GENERATORS[i]
        }
    }
    return chk >>> 0
}

function hrpExpand(hrp: string): number[] {
    const out: number[] = []
    for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5)
    out.push(0)
    for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31)
    return out
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
    let acc = 0
    let bits = 0
    const out: number[] = []
    const maxv = (1 << to) - 1
    for (const value of data) {
        if (value < 0 || value >> from !== 0) return null
        acc = (acc << from) | value
        bits += from
        while (bits >= to) {
            bits -= to
            out.push((acc >> bits) & maxv)
        }
    }
    if (pad) {
        if (bits > 0) out.push((acc << (to - bits)) & maxv)
    } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
        return null
    }
    return out
}

/** Decode a lowercase bech32 string; returns the hrp and payload bytes, or null. */
export function decodeBech32(addr: string): { hrp: string; bytes: number[] } | null {
    if (typeof addr !== "string" || addr.length > 90 || addr !== addr.toLowerCase()) return null
    const sep = addr.lastIndexOf("1")
    if (sep < 1 || sep + 7 > addr.length) return null
    const hrp = addr.slice(0, sep)
    const data: number[] = []
    for (const ch of addr.slice(sep + 1)) {
        const idx = CHARSET.indexOf(ch)
        if (idx === -1) return null
        data.push(idx)
    }
    if (polymod([...hrpExpand(hrp), ...data]) !== 1) return null
    const bytes = convertBits(data.slice(0, -6), 5, 8, false)
    return bytes ? { hrp, bytes } : null
}

/** Encode payload bytes as a bech32 string with the given hrp. */
export function encodeBech32(hrp: string, bytes: number[]): string {
    const data = convertBits(bytes, 8, 5, true)
    if (!data) throw new Error("invalid payload")
    const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1
    const checksum: number[] = []
    for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31)
    return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("")
}

/** True when addr is a checksummed bech32 address with the hrp and a 20-byte payload. */
export function isChecksummedAddress(addr: string, hrp: string): boolean {
    const decoded = decodeBech32(addr)
    return decoded !== null && decoded.hrp === hrp && decoded.bytes.length === 20
}
