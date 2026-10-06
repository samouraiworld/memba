/**
 * The typed canonical argument encoding of memba_gov (`p/samcrew/daoauth`):
 * fields joined by "|", each `u:` uint64, `i:` int64, `b:` 0 or 1, `a:` a
 * lowercase bech32 address, or `s:<len>:<printable ASCII>`. Every value has
 * one spelling; parse refuses anything else, as the realm does.
 */
import { address } from "./weightedPrimitives"

export const MAX_ARGS = 1024
export const MAX_TEXT = 512

export type DaoauthTag = "u" | "i" | "b" | "a" | "s"
export type DaoauthField = { tag: DaoauthTag; value: string }

const UINT64_MAX = 18446744073709551615n
const INT64_MIN = -9223372036854775808n, INT64_MAX = 9223372036854775807n

/** At most 512 bytes of printable ASCII (0x20-0x7E). */
export function validText(s: string): boolean {
    return s.length <= MAX_TEXT && /^[\x20-\x7e]*$/.test(s)
}

function scalarOK(tag: string, v: string): boolean {
    switch (tag) {
        case "u": return /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v) <= UINT64_MAX
        case "i": return /^(0|-?[1-9][0-9]*)$/.test(v) && BigInt(v) >= INT64_MIN && BigInt(v) <= INT64_MAX
        case "b": return v === "0" || v === "1"
        case "a": return address.safeParse(v).success
    }
    return false
}

/** Decodes canonical args; throws on any other text. "" is no fields. */
export function parseArgs(s: string): DaoauthField[] {
    if (s.length > MAX_ARGS || !/^[\x20-\x7e]*$/.test(s)) throw new Error("Invalid arguments")
    const out: DaoauthField[] = []
    let rest = s
    while (rest.length > 0) {
        if (rest.length < 2 || rest[1] !== ":") throw new Error("Invalid arguments")
        const tag = rest[0]
        rest = rest.slice(2)
        let value: string
        if (tag === "s") {
            const colon = rest.indexOf(":"), len = rest.slice(0, colon)
            if (colon < 1 || !/^(0|[1-9][0-9]*)$/.test(len) || Number(len) > rest.length - colon - 1) throw new Error("Invalid arguments")
            value = rest.slice(colon + 1, colon + 1 + Number(len))
            rest = rest.slice(colon + 1 + Number(len))
            if (!validText(value)) throw new Error("Invalid arguments")
        } else {
            const bar = rest.indexOf("|"), end = bar < 0 ? rest.length : bar
            value = rest.slice(0, end)
            rest = rest.slice(end)
            if (!scalarOK(tag, value)) throw new Error("Invalid arguments")
        }
        out.push({ tag: tag as DaoauthTag, value })
        if (rest.length > 0) {
            if (rest[0] !== "|" || rest.length === 1) throw new Error("Invalid arguments")
            rest = rest.slice(1)
        }
    }
    return out
}

/** Encodes fields, refusing any value without a canonical form. */
export function encodeArgs(fields: readonly DaoauthField[]): string {
    const s = fields.map(({ tag, value }) => {
        if (tag === "s") {
            if (!validText(value)) throw new Error("Text must be printable ASCII of at most 512 characters")
            return `s:${value.length}:${value}`
        }
        if (!scalarOK(tag, value)) throw new Error(tag === "a" ? "Address must be lowercase bech32" : "Invalid value")
        return `${tag}:${value}`
    }).join("|")
    if (s.length > MAX_ARGS) throw new Error("Arguments exceed 1024 characters")
    return s
}
