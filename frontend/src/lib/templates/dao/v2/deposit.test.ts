import { describe, expect, it } from "vitest"
import { DAO_V2_MAX_DEPOSIT, daoDepositCapUgnot, estimateDAOStorageBytes, formatGnot, type DepositInput } from "./deposit"

const label = (p: string, i: number) => (p + String(i).padStart(2, "0") + "x".repeat(30)).slice(0, 30)
const roles16 = Array.from({ length: 16 }, (_, i) => label("role", i))
const cats16 = Array.from({ length: 16 }, (_, i) => label("cat", i))
const small: DepositInput = { name: "Small DAO", description: "A small DAO", roles: ["admin", "member"], proposalCategories: ["governance"], members: [{ roles: ["admin"] }] }
const many = (n: number, roles: string[]) => Array.from({ length: n }, () => ({ roles }))

// Storage bytes measured at gno 31b6650a for these exact configurations.
const MEASURED: [string, DepositInput, number][] = [
    ["small", small, 60_230],
    ["labels", { ...small, roles: roles16, proposalCategories: cats16, members: [{ roles: roles16 }] }, 64_133],
    ["text", { ...small, name: "€".repeat(64), description: "€".repeat(1000) }, 65_873],
    ["100 members, no roles", { ...small, members: many(100, []) }, 391_743],
    ["100 members, one role", { ...small, members: many(100, ["member"]) }, 399_480],
    ["50 members, 16 roles", { ...small, roles: roles16, members: many(50, roles16) }, 298_669],
    ["maximal", { name: "€".repeat(64), description: "€".repeat(1000), roles: roles16, proposalCategories: cats16, members: many(100, roles16) }, 546_792],
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
        expect(daoDepositCapUgnot(MEASURED[6][1])).toBe(110_000_000)
    })

    it("a small DAO gets a small cap and the floor is 2 GNOT", () => {
        expect(daoDepositCapUgnot(small)).toBe(13_000_000)
        expect(daoDepositCapUgnot({ ...small, members: [] })).toBeGreaterThanOrEqual(2_000_000)
    })

    it("formats GNOT amounts", () => {
        expect(formatGnot(13_000_000)).toBe("13 GNOT")
        expect(formatGnot(6_221_300)).toBe("6.2 GNOT")
    })
})
