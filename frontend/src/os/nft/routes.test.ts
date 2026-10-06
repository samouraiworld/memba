import { describe, expect, it } from "vitest"
import { getApp } from "../apps"
import { sectionForClassic } from "../page/classicRoute"
import { marketNftSection, nftSection, parseMarketNftSection, parseNftSection, type MarketNftRoute, type NftRoute } from "./routes"

const LONGEST_ID = `C${"9".repeat(20)}`
const LARGEST_NUMBER = 9_223_372_036_854_775_807n

const NFT_ROUTES: [string | null, NftRoute][] = [
    [null, { kind: "home" }],
    ["c/C1", { kind: "collection", collection: "C1" }],
    [`c/${LONGEST_ID}`, { kind: "collection", collection: LONGEST_ID }],
    ["c/C12/7", { kind: "token", collection: "C12", number: 7n }],
    ["c/C1/1", { kind: "token", collection: "C1", number: 1n }],
    ["c/C1/10", { kind: "token", collection: "C1", number: 10n }],
    // Above 2^53: the number is never a float.
    ["c/C1/9007199254740993", { kind: "token", collection: "C1", number: 9_007_199_254_740_993n }],
    [`c/C1/${LARGEST_NUMBER}`, { kind: "token", collection: "C1", number: LARGEST_NUMBER }],
    ["mine", { kind: "mine" }],
    ["create", { kind: "create" }],
    ["studio", { kind: "studio" }],
    ["studio/C3", { kind: "studio-collection", collection: "C3" }],
]

const MARKET_ROUTES: [string, MarketNftRoute][] = [
    ["nfts", { kind: "explore" }],
    ["nfts/c/C1", { kind: "collection", collection: "C1" }],
    [`nfts/c/${LONGEST_ID}`, { kind: "collection", collection: LONGEST_ID }],
    ["nfts/c/C12/7", { kind: "token", collection: "C12", number: 7n }],
    [`nfts/c/C1/${LARGEST_NUMBER}`, { kind: "token", collection: "C1", number: LARGEST_NUMBER }],
    ["nfts/mine", { kind: "mine" }],
    ["nfts/ops", { kind: "operations" }],
    ["nfts/ops/c/C1", { kind: "application", collection: "C1" }],
    [`nfts/ops/c/${LONGEST_ID}`, { kind: "application", collection: LONGEST_ID }],
]

/** What follows `c/` is read by one rule in both apps, so both refuse the same things. */
const MALFORMED_COLLECTION_PATHS = [
    "c", "c/", "c//7", "c/C1/", "c/C1//", "c/C1/7/", "c/C1/7/8", "c/C1/7/history",
    "C/C1", "c/c1", "c/1", "c/C", "c/C0", "c/C01", "c/C1a", "c/C-1", "c/C1 ", "c/ C1", `c/C${"9".repeat(21)}`,
    "c/C1/0", "c/C1/07", "c/C1/-1", "c/C1/+1", "c/C1/1.0", "c/C1/1e3", "c/C1/0x1", "c/C1/ 7", "c/C1/7 ", "c/C1/seven", "c/C1/１",
    "c/C1/9223372036854775808", `c/C1/1${"0".repeat(19)}`, `c/C1/${"9".repeat(20)}`,
    "collection/C1", "cc/C1", "c\\C1",
]

describe("NFT app sections", () => {
    it.each(NFT_ROUTES)("reads %j, and builds it back", (section, route) => {
        expect(parseNftSection(section)).toEqual(route)
        expect(nftSection(route)).toBe(section)
    })

    it("round-trips every route it can read, from the section and from the route", () => {
        for (const [section, route] of NFT_ROUTES) {
            const parsed = parseNftSection(section)
            expect(parsed).not.toBeNull()
            expect(nftSection(parsed as NftRoute)).toBe(section)
            expect(parseNftSection(nftSection(route))).toEqual(route)
        }
        // Every kind of the union is in the table.
        expect(new Set(NFT_ROUTES.map(([, route]) => route.kind))).toEqual(new Set(["home", "collection", "token", "mine", "create", "studio", "studio-collection"]))
    })

    it.each([
        ...MALFORMED_COLLECTION_PATHS,
        "", "/", "home", "null",
        "Mine", "MINE", "mine/", "/mine", "mine ", "mine/C1", "my",
        "Create", "create/", "create/advanced", "create/C1",
        "Studio", "studio/", "studio/c1", "studio/C0", "studio/C1/", "studio/C1/7", "studio/C1/settings", "studio//C1",
        "nfts", "nfts/c/C1", "nfts/mine",
    ])("leaves %j to the fallback", (section) => {
        expect(parseNftSection(section)).toBeNull()
    })
})

describe("Market NFT-lane sections", () => {
    it.each(MARKET_ROUTES)("reads %j, and builds it back", (section, route) => {
        expect(parseMarketNftSection(section)).toEqual(route)
        expect(marketNftSection(route)).toBe(section)
    })

    it("round-trips every route it can read, from the section and from the route", () => {
        for (const [section, route] of MARKET_ROUTES) {
            const parsed = parseMarketNftSection(section)
            expect(parsed).not.toBeNull()
            expect(marketNftSection(parsed as MarketNftRoute)).toBe(section)
            expect(parseMarketNftSection(marketNftSection(route))).toEqual(route)
        }
        expect(new Set(MARKET_ROUTES.map(([, route]) => route.kind))).toEqual(new Set(["explore", "collection", "token", "mine", "operations", "application"]))
    })

    it("is not Market's home, which lists the lanes", () => {
        expect(parseMarketNftSection(null)).toBeNull()
    })

    it.each([
        ...MALFORMED_COLLECTION_PATHS.map((path) => `nfts/${path}`),
        "", "/", "NFTS", "Nfts", "nft", "nfts/", "/nfts", "nfts ", "nfts//c/C1",
        "nfts/Mine", "nfts/mine/", "nfts/mine/C1", "nfts/create", "nfts/studio", "nfts/studio/C1",
        "nfts/ops/", "nfts/Ops", "nfts/ops/c", "nfts/ops/c/", "nfts/ops/c/c1", "nfts/ops/c/C01", "nfts/ops/c/C1/7", "nfts/ops/c/C1/", "nfts/ops/C1",
        "c/C1", "c/C1/7", "mine", "create", "studio",
        "services", "marketplace/services", "marketplace/nfts", "tokens", "agents", "my-listings",
    ])("leaves %j to the fallback", (section) => {
        expect(parseMarketNftSection(section)).toBeNull()
    })
})

describe("a route that could not have been read", () => {
    it.each<[string, NftRoute & MarketNftRoute]>([
        ["a collection ID in another case", { kind: "collection", collection: "c1" }],
        ["a collection ID with a path in it", { kind: "collection", collection: "C1/../C2" }],
        ["no collection ID", { kind: "token", collection: "", number: 7n }],
        ["token number 0", { kind: "token", collection: "C1", number: 0n }],
        ["a negative token number", { kind: "token", collection: "C1", number: -1n }],
        ["a token number above int64", { kind: "token", collection: "C1", number: 2n ** 63n }],
        ["a token number of 20 digits", { kind: "token", collection: "C1", number: 10n ** 19n }],
    ])("is never built into a section: %s", (_name, route) => {
        expect(() => nftSection(route)).toThrow(/^Invalid (collection ID|token number)$/)
        expect(() => marketNftSection(route)).toThrow(/^Invalid (collection ID|token number)$/)
    })

    it("is never built into a studio or an application section either", () => {
        expect(() => nftSection({ kind: "studio-collection", collection: "C1/7" })).toThrow(/^Invalid collection ID$/)
        expect(() => marketNftSection({ kind: "application", collection: "C1/7" })).toThrow(/^Invalid collection ID$/)
    })
})

/** One page per route of the app's table, as the classic router would match it. */
const classicPages = (app: "nft" | "market", splat: string[]) => getApp(app).routes.flatMap((route) => route.endsWith("/*")
    ? [route.slice(0, -2), ...splat.map((rest) => `${route.slice(0, -1)}${rest}`)]
    : [route.replace(/:realmPath/, "gno.land%2Fr%2Fdemo%2Fart").replace(/:(address|creator)/, "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5").replace(/:slug/, "relevés").replace(/:tokenId/, "7")])

describe("classic pages", () => {
    it("reach the NFT window under a native section only where the native view replaces them", () => {
        const taken = classicPages("nft", [])
            .map((page) => [page, sectionForClassic("nft", page)] as const)
            .filter(([, section]) => parseNftSection(section) !== null)
        // The classic create page and studio list arrive as the very sections the native view names the same way.
        expect(taken).toEqual([["nft", null], ["nft/create", "create"], ["nft/studio", "studio"]])
    })

    it("reach the Market window under a native section only for the NFT lane itself", () => {
        const taken = classicPages("market", ["nfts", "services", "services/contract/7", "tokens", "agents", "my-listings"])
            .map((page) => [page, sectionForClassic("market", page)] as const)
            .filter(([, section]) => parseMarketNftSection(section) !== null)
        expect(taken).toEqual([["marketplace/nfts", "nfts"]])
    })
})
