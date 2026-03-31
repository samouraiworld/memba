import { describe, it, expect } from "vitest"
import {
    isValidPaymentConfig,
    isValidListingType,
    calculatePlatformFee,
    isNativeToken,
    DEFAULT_PAYMENT_CONFIG,
    type PaymentConfig,
} from "./types"

describe("isValidPaymentConfig", () => {
    it("accepts valid GNOT config", () => {
        const config: PaymentConfig = {
            denom: "ugnot",
            amount: 1_000_000n,
            feePercent: 2.5,
            feeRecipient: "g1admin",
        }
        expect(isValidPaymentConfig(config)).toBe(true)
    })

    it("accepts valid GRC20 config", () => {
        const config: PaymentConfig = {
            denom: "gno.land/r/demo/grc20/memba",
            amount: 500n,
            feePercent: 0,
            feeRecipient: "",
        }
        expect(isValidPaymentConfig(config)).toBe(true)
    })

    it("accepts zero amount", () => {
        const config: PaymentConfig = {
            denom: "ugnot",
            amount: 0n,
            feePercent: 0,
            feeRecipient: "",
        }
        expect(isValidPaymentConfig(config)).toBe(true)
    })

    it("rejects null", () => {
        expect(isValidPaymentConfig(null)).toBe(false)
    })

    it("rejects empty denom", () => {
        expect(isValidPaymentConfig({
            denom: "",
            amount: 100n,
            feePercent: 2.5,
            feeRecipient: "",
        })).toBe(false)
    })

    it("rejects fee > 100%", () => {
        expect(isValidPaymentConfig({
            denom: "ugnot",
            amount: 100n,
            feePercent: 150,
            feeRecipient: "",
        })).toBe(false)
    })

    it("rejects negative fee", () => {
        expect(isValidPaymentConfig({
            denom: "ugnot",
            amount: 100n,
            feePercent: -1,
            feeRecipient: "",
        })).toBe(false)
    })

    it("rejects non-object", () => {
        expect(isValidPaymentConfig("string")).toBe(false)
        expect(isValidPaymentConfig(42)).toBe(false)
    })
})

describe("isValidListingType", () => {
    it("accepts service", () => expect(isValidListingType("service")).toBe(true))
    it("accepts agent", () => expect(isValidListingType("agent")).toBe(true))
    it("accepts nft", () => expect(isValidListingType("nft")).toBe(true))
    it("rejects unknown", () => expect(isValidListingType("auction")).toBe(false))
    it("rejects null", () => expect(isValidListingType(null)).toBe(false))
})

describe("calculatePlatformFee", () => {
    it("calculates 2.5% of 1 GNOT", () => {
        const fee = calculatePlatformFee(1_000_000n, 2.5)
        expect(fee).toBe(25_000n)
    })

    it("calculates 5% of 10 GNOT", () => {
        const fee = calculatePlatformFee(10_000_000n, 5)
        expect(fee).toBe(500_000n)
    })

    it("returns 0 for 0% fee", () => {
        expect(calculatePlatformFee(1_000_000n, 0)).toBe(0n)
    })

    it("returns 0 for 0 amount", () => {
        expect(calculatePlatformFee(0n, 2.5)).toBe(0n)
    })

    it("handles fractional percentages", () => {
        const fee = calculatePlatformFee(1_000_000n, 0.1)
        expect(fee).toBe(1_000n)
    })
})

describe("isNativeToken", () => {
    it("ugnot is native", () => expect(isNativeToken("ugnot")).toBe(true))
    it("GRC20 path is not native", () => expect(isNativeToken("gno.land/r/demo/grc20/memba")).toBe(false))
    it("empty string is not native", () => expect(isNativeToken("")).toBe(false))
})

describe("DEFAULT_PAYMENT_CONFIG", () => {
    it("has ugnot denom", () => expect(DEFAULT_PAYMENT_CONFIG.denom).toBe("ugnot"))
    it("has 2.5% fee", () => expect(DEFAULT_PAYMENT_CONFIG.feePercent).toBe(2.5))
})
