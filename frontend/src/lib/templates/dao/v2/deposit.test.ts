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
    ["small", small, 60_292, 43_652_595],
    ["labels", { ...small, roles: roles16, proposalCategories: cats16, members: [{ roles: roles16 }] }, 64_677, 46_143_431],
    ["text", { ...small, name: "€".repeat(64), description: "€".repeat(1000) }, 66_409, 51_855_364],
    ["10 members, one role", { ...small, members: many(10, ["member"]) }, 91_186, 48_209_232],
    ["10 members, 16 roles", { ...small, roles: roles16, members: many(10, roles16) }, 106_824, 59_704_892],
    ["25 members, mid text", { name: "x".repeat(40), description: "y".repeat(400), roles: ["admin", "dev", "member"], proposalCategories: ["governance"], members: many(25, ["dev", "member"]) }, 144_873, 58_960_471],
    ["50 members, one role", { ...small, members: many(50, ["member"]) }, 227_582, 74_059_121],
    ["50 members, 16 roles", { ...small, roles: roles16, members: many(50, roles16) }, 299_460, 128_717_990],
    ["100 members, no roles", { ...small, members: many(100, []) }, 391_664, 107_368_166],
    ["100 members, one role", { ...small, members: many(100, ["member"]) }, 398_523, 110_169_043],
    ["100 members, 16 roles", { ...small, roles: roles16, members: many(100, roles16) }, 540_701, 217_632_679],
    ["maximal", { name: "€".repeat(64), description: "€".repeat(1000), roles: roles16, proposalCategories: cats16, members: many(100, roles16) }, 547_579, 227_678_456],
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
        expect(DAO_V2_MAX_DEPOSIT).toBe(`${Math.ceil((547_579 * 100 * 2) / 1_000_000) * 1_000_000}ugnot`)
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
