import { describe, expect, it } from "vitest"
import { DAO_V2_MAX_DEPOSIT, daoDepositCapUgnot, estimateDAOStorageBytes, estimateDeployGas, formatGnot, type DepositInput } from "./deposit"

const label = (p: string, i: number) => (p + String(i).padStart(2, "0") + "x".repeat(30)).slice(0, 30)
const roles16 = Array.from({ length: 16 }, (_, i) => label("role", i))
const cats16 = Array.from({ length: 16 }, (_, i) => label("cat", i))
const small: DepositInput = { name: "Small DAO", description: "A small DAO", roles: ["admin", "member"], proposalCategories: ["governance"], members: [{ roles: ["admin"] }] }
const many = (n: number, roles: string[]) => Array.from({ length: n }, () => ({ roles }))

// Storage bytes and AddPackage gas measured at gno 31b6650a (in-memory node,
// gnokey maketx addpkg) for these exact configurations.
const MEASURED: [string, DepositInput, number, number][] = [
    ["small", small, 60_230, 42_893_247],
    ["labels", { ...small, roles: roles16, proposalCategories: cats16, members: [{ roles: roles16 }] }, 64_133, 45_368_209],
    ["text", { ...small, name: "€".repeat(64), description: "€".repeat(1000) }, 65_873, 51_080_278],
    ["10 members, one role", { ...small, members: many(10, ["member"]) }, 90_400, 47_353_715],
    ["10 members, 16 roles", { ...small, roles: roles16, members: many(10, roles16) }, 106_034, 58_849_307],
    ["25 members, mid text", { name: "x".repeat(40), description: "y".repeat(400), roles: ["admin", "dev", "member"], proposalCategories: ["governance"], members: many(25, ["dev", "member"]) }, 144_087, 57_984_431],
    ["50 members, one role", { ...small, members: many(50, ["member"]) }, 226_795, 72_882_147],
    ["50 members, 16 roles", { ...small, roles: roles16, members: many(50, roles16) }, 298_669, 127_540_965],
    ["100 members, no roles", { ...small, members: many(100, []) }, 391_743, 105_811_777],
    ["100 members, one role", { ...small, members: many(100, ["member"]) }, 399_480, 108_635_263],
    ["100 members, 16 roles", { ...small, roles: roles16, members: many(100, roles16) }, 539_906, 216_053_738],
    ["maximal", { name: "€".repeat(64), description: "€".repeat(1000), roles: roles16, proposalCategories: cats16, members: many(100, roles16) }, 546_792, 226_104_759],
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
        expect(DAO_V2_MAX_DEPOSIT).toBe(`${Math.ceil((546_792 * 100 * 2) / 1_000_000) * 1_000_000}ugnot`)
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

    it("the deploy gas estimate stays within 50M and 500M", () => {
        expect(estimateDeployGas({ ...small, members: [] })).toBeGreaterThanOrEqual(50_000_000)
        expect(estimateDeployGas(MEASURED[0][1])).toBeGreaterThanOrEqual(50_000_000)
        expect(estimateDeployGas(MEASURED[11][1])).toBeLessThanOrEqual(500_000_000)
        expect(estimateDeployGas({ ...small, members: many(10_000, roles16) })).toBe(500_000_000)
    })

    it("formats GNOT amounts", () => {
        expect(formatGnot(13_000_000)).toBe("13 GNOT")
        expect(formatGnot(6_221_300)).toBe("6.2 GNOT")
    })
})
