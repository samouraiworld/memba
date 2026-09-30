import { describe, expect, it } from "vitest"
import { formatAmount, formatBPS } from "./format"

describe("amount", () => {
    it.each([
        ["nothing", 0n, "0 GNOT"],
        ["one ugnot", 1n, "0.000001 GNOT"],
        ["one GNOT", 1_000_000n, "1 GNOT"],
        ["one and a half", 1_500_000n, "1.5 GNOT"],
        ["six decimals", 12_345_678n, "12.345678 GNOT"],
        ["zeros inside the fraction", 1_000_100n, "1.0001 GNOT"],
        ["thousands", 2_500_000_000n, "2,500 GNOT"],
        // 2^53 + 1 ugnot: a float would round the last digit away.
        ["an amount above 2^53", 9_007_199_254_740_993n, "9,007,199,254.740993 GNOT"],
        ["the largest int64", 9_223_372_036_854_775_807n, "9,223,372,036,854.775807 GNOT"],
    ])("writes %s exactly, in GNOT", (_name, ugnot, text) => {
        expect(formatAmount(ugnot, "ugnot")).toBe(text)
    })

    it.each([
        ["a registry key", 1_500n, "gno.land/r/demo/foo20", "1,500 foo20"],
        ["a key with a sub-token", 1n, "gno.land/r/demo/tokens.wgnot", "1 tokens.wgnot"],
        ["a key with no path", 0n, "foo20", "0 foo20"],
        ["a key that ends with a slash", 7n, "gno.land/r/demo/", "7 gno.land/r/demo/"],
        ["an amount above 2^53", 9_007_199_254_740_993n, "gno.land/r/demo/foo20", "9,007,199,254,740,993 foo20"],
        // Only the exact native key is GNOT: nothing that resembles it is given its decimals.
        ["a token that is named like the native coin", 1_500_000n, "gno.land/r/evil/ugnot", "1,500,000 ugnot"],
        ["the native key in another case", 1_500_000n, "UGNOT", "1,500,000 UGNOT"],
    ])("writes %s as the integer the realm stated", (_name, amount, currency, text) => {
        expect(formatAmount(amount, currency)).toBe(text)
    })
})

describe("rate", () => {
    it.each([
        [0n, "0%"],
        [1n, "0.01%"],
        [10n, "0.1%"],
        [125n, "1.25%"],
        [250n, "2.5%"],
        [500n, "5%"],
        [1_005n, "10.05%"],
        [10_000n, "100%"],
    ])("writes %d basis points as %s", (bps, text) => {
        expect(formatBPS(bps)).toBe(text)
    })
})
