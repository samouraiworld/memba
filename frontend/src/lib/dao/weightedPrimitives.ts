/** Scalar shapes shared by every weighted-host read contract version. */
import { z } from "zod"
import { bech32Encode } from "./realmAddress"

export const realm = z.string().regex(/^gno\.land\/r\/samcrew\/[a-z][a-z0-9_]{0,63}$/)
export const uint64 = z.string().regex(/^(0|[1-9][0-9]{0,19})$/).refine(s => BigInt(s) <= 18446744073709551615n)
export const id = uint64.refine(s => s !== "0")
export const address = z.string().regex(/^g1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/).refine(value => {
    const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l", bytes: number[] = []
    let acc = 0, bits = 0
    for (const c of value.slice(2, 34)) {
        const word = alphabet.indexOf(c)
        if (word < 0) return false
        acc = (acc << 5) | word; bits += 5
        if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255) }
    }
    return bytes.length === 20 && bech32Encode("g", new Uint8Array(bytes)) === value
}, "Invalid Gno address checksum")
/** The host writes an unset address as the empty string, never null. */
export const blank = z.literal("")
export const optionalAddress = z.union([blank, address])
export const personID = z.string().min(1).max(320)
export const role = z.enum(["admin", "finance"])
export const time = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 19) === s.slice(0, 19))
export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)
/** Bounded free text copied from a target realm (names, reasons, role lists). */
export const text = (max: number) => z.string().max(max)
