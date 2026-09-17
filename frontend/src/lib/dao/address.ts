/**
 * Full Gno address validation (bech32 shape AND checksum). A regex-only check
 * accepts mistyped addresses; DAO writes and member parsing use this instead.
 */
import { bech32Encode } from "./realmAddress"

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const SHAPE = /^g1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/

export function isValidGnoAddressChecksum(value: unknown): value is string {
    if (typeof value !== "string" || !SHAPE.test(value)) return false
    const bytes: number[] = []
    let acc = 0
    let bits = 0
    // 32 data characters carry the 20-byte payload; the last 6 are the checksum.
    for (const c of value.slice(2, 34)) {
        acc = (acc << 5) | CHARSET.indexOf(c)
        bits += 5
        if (bits >= 8) {
            bits -= 8
            bytes.push((acc >> bits) & 255)
        }
    }
    return bytes.length === 20 && bech32Encode("g", new Uint8Array(bytes)) === value
}
