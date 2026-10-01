import { describe, expect, it } from "vitest"
import { isUserCancellation } from "./userCancellation"

describe("isUserCancellation", () => {
    it("detects user rejected", () => {
        expect(isUserCancellation("User rejected the request")).toBe(true)
    })

    it("detects user denied", () => {
        expect(isUserCancellation(new Error("user denied"))).toBe(true)
    })

    it("detects a wallet reject and the confirmation dialog's cancel", () => {
        expect(isUserCancellation(new Error("Transaction rejected by user"))).toBe(true)
        expect(isUserCancellation(new Error("Transaction cancelled by user"))).toBe(true)
        expect(isUserCancellation("Request canceled")).toBe(true)
    })

    it("returns false for real errors", () => {
        expect(isUserCancellation("out of gas")).toBe(false)
    })
})
