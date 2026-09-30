import { describe, expect, it } from "vitest"
import { depositCapUgnot } from "../../lib/dao/v2Budget"
import { FALLBACK_GAS_PRICE } from "../../lib/grc20"
import { profilePublishCosts, profileStorageBytes } from "./profileBudget"

const created = (size: number) => ({ before: "", after: "x".repeat(size), created: true })
const rewritten = (from: number, to: number) => ({ before: "x".repeat(from), after: "x".repeat(to), created: false })

describe("profile publish budget", () => {
    // `.app/simulate` on gnoland-1, 2026-09-30: [value bytes, bytes the chain charged].
    it.each([[0, 2099], [5, 2095], [100, 2204], [256, 2368], [320, 2435], [400, 2512], [2000, 4107], [3675, 5795]])(
        "covers a first write of %i bytes (measured %i)", (size, measured) => {
            const estimate = profileStorageBytes(created(size))
            expect(estimate).toBeGreaterThanOrEqual(measured)
            expect(depositCapUgnot(estimate)).toBeGreaterThanOrEqual(2 * measured * 100)
        })

    it.each([[100, 100, 0], [100, 400, 303], [400, 0, -408]])("covers a rewrite from %i to %i bytes (measured %i)", (from, to, measured) => {
        const estimate = profileStorageBytes(rewritten(from, to))
        expect(estimate).toBeGreaterThanOrEqual(measured)
        expect(depositCapUgnot(estimate)).toBeGreaterThanOrEqual(Math.max(2 * measured * 100, 10_000))
    })

    // The 2,000-byte and 320-byte points above were measured with 500 and 80 four-byte characters.
    it("counts multi-byte characters as the bytes the chain stores", () => {
        expect(profileStorageBytes({ before: "", after: "😀".repeat(500), created: true })).toBe(profileStorageBytes(created(2000)))
        expect(profileStorageBytes({ before: "", after: "😀".repeat(80), created: true })).toBeGreaterThanOrEqual(2435)
    })

    // Measured gas for one, two, three and six calls in one transaction.
    it.each([[1, 6_205_117], [2, 6_891_535], [3, 7_675_947], [6, 10_121_764]])("gives %i call(s) a gas limit of at least twice the measured %i", (calls, measured) => {
        const { gasWanted, feeUgnot } = profilePublishCosts(Array.from({ length: calls }, () => created(10)), FALLBACK_GAS_PRICE)
        expect(gasWanted).toBeGreaterThanOrEqual(2 * measured)
        expect(gasWanted).toBeLessThanOrEqual(24_000_000)
        expect(feeUgnot).toBe(Math.ceil(gasWanted * 1.2 / 1000))
    })

    it("sums each call's estimate and cap", () => {
        const costs = profilePublishCosts([created(0), rewritten(10, 10)], FALLBACK_GAS_PRICE)
        expect(costs.depositUgnot).toBe(220_000 + 6_400)
        expect(costs.depositCapUgnot).toBe(440_000 + 20_000)
    })
})
