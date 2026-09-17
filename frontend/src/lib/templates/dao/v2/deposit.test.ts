import { describe, expect, it } from "vitest"
import { DAO_V2_MAX_DEPOSIT, daoDepositCapUgnot, estimateDAOStorageBytes, estimateDeployGas, estimateSubmitGas, formatGnot, type DepositInput } from "./deposit"

const label = (p: string, i: number) => (p + String(i).padStart(2, "0") + "x".repeat(30)).slice(0, 30)
const roles16 = Array.from({ length: 16 }, (_, i) => label("role", i))
const cats16 = Array.from({ length: 16 }, (_, i) => label("cat", i))
const small: DepositInput = { name: "Small DAO", description: "A small DAO", roles: ["admin", "member"], proposalCategories: ["governance"], members: [{ roles: ["admin"] }] }
const many = (n: number, roles: string[]) => Array.from({ length: n }, () => ({ roles }))

// Measured at gno 31b6650a on an in-memory node for these exact configurations:
// storage bytes and AddPackage gas under the permissionless policy, and the
// AddPackage (submit) gas under the inert policy, where the package is stored
// without being type-checked or initialised.
const MEASURED: [string, DepositInput, number, number, number][] = [
    ["small", small, 60_509, 44_881_024, 36_486_071],
    ["labels", { ...small, roles: roles16, proposalCategories: cats16, members: [{ roles: roles16 }] }, 64_894, 47_371_860, 38_519_136],
    ["text", { ...small, name: "€".repeat(64), description: "€".repeat(1000) }, 66_626, 53_083_793, 44_584_724],
    ["10 members, one role", { ...small, members: many(10, ["member"]) }, 91_403, 49_437_661, 37_466_902],
    ["10 members, 16 roles", { ...small, roles: roles16, members: many(10, roles16) }, 107_041, 60_933_321, 44_959_159],
    ["25 members, mid text", { name: "x".repeat(40), description: "y".repeat(400), roles: ["admin", "dev", "member"], proposalCategories: ["governance"], members: many(25, ["dev", "member"]) }, 145_090, 60_188_900, 40_400_188],
    ["50 members, one role", { ...small, members: many(50, ["member"]) }, 227_799, 75_287_550, 41_808_719],
    ["50 members, 16 roles", { ...small, roles: roles16, members: many(50, roles16) }, 299_677, 129_946_419, 76_577_679],
    ["100 members, no roles", { ...small, members: many(100, []) }, 391_881, 108_596_595, 46_219_639],
    ["100 members, one role", { ...small, members: many(100, ["member"]) }, 398_740, 111_397_472, 48_387_904],
    ["100 members, 16 roles", { ...small, roles: roles16, members: many(100, roles16) }, 540_918, 218_861_108, 116_103_464],
    ["maximal", { name: "€".repeat(64), description: "€".repeat(1000), roles: roles16, proposalCategories: cats16, members: many(100, roles16) }, 547_796, 228_906_885, 126_029_423],
]

describe("DAO v2 storage deposit", () => {
    it.each(MEASURED)("the estimate is never below the measured storage: %s", (_label, input, measured) => {
        const estimate = estimateDAOStorageBytes(input)
        expect(estimate).toBeGreaterThanOrEqual(measured)
        expect(estimate).toBeLessThan(measured * 1.3)
    })

    it.each(MEASURED)("the cap covers twice the measured deposit, capped by the maximum: %s", (_label, input, measured) => {
        expect(daoDepositCapUgnot(input)).toBeGreaterThanOrEqual(Math.min(2 * measured * 100, 110_000_000))
        expect(daoDepositCapUgnot(input) % 1_000_000).toBe(0)
    })

    it("the maximum cap is twice the largest measured deploy, rounded up to a whole GNOT", () => {
        expect(DAO_V2_MAX_DEPOSIT).toBe(`${Math.ceil((547_796 * 100 * 2) / 1_000_000) * 1_000_000}ugnot`)
        expect(daoDepositCapUgnot(MEASURED[11][1])).toBe(110_000_000)
    })

    it("a small DAO gets a small cap and the floor is 2 GNOT", () => {
        expect(daoDepositCapUgnot(small)).toBe(13_000_000)
        expect(daoDepositCapUgnot({ ...small, members: [] })).toBeGreaterThanOrEqual(2_000_000)
    })

    it.each(MEASURED)("the deploy gas estimate is at least 1.2x the measured gas: %s", (_label, input, _bytes, gas) => {
        const estimate = estimateDeployGas(input)
        expect(estimate).toBeGreaterThanOrEqual(gas * 1.2)
        expect(estimate % 1_000_000).toBe(0)
    })

    it.each(MEASURED)("the inert submit gas estimate is at least 1.2x the measured gas: %s", (_label, input, _bytes, _gas, submitGas) => {
        const estimate = estimateSubmitGas(input)
        expect(estimate).toBeGreaterThanOrEqual(submitGas * 1.2)
        expect(estimate).toBeLessThan(estimateDeployGas(input))
        expect(estimate % 1_000_000).toBe(0)
    })

    it("the deploy gas estimate stays within 50M and 500M", () => {
        expect(estimateDeployGas({ ...small, members: [] })).toBeGreaterThanOrEqual(50_000_000)
        expect(estimateDeployGas(MEASURED[0][1])).toBeGreaterThanOrEqual(50_000_000)
        expect(estimateDeployGas(MEASURED[11][1])).toBeLessThanOrEqual(500_000_000)
        expect(estimateDeployGas({ ...small, members: many(10_000, roles16) })).toBe(500_000_000)
    })

    it("formats GNOT amounts", () => {
        expect(formatGnot(13_000_000)).toBe("13 GNOT")
        expect(formatGnot(6_221_300)).toBe("6.2 GNOT")
        expect(formatGnot(57_600)).toBe("0.058 GNOT")
        expect(formatGnot(400_800)).toBe("0.401 GNOT")
    })
})
