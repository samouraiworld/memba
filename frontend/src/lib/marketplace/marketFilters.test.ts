/**
 * marketFilters.test.ts — honest filter/sort + URL round-trip (marketplace-v2 Phase 3.1).
 */
import { describe, it, expect } from "vitest"
import { applyFilters, parseFilters, filtersToParams, DEFAULT_FILTERS, type MarketFilters } from "./marketFilters"
import type { CardModel } from "./types"

const mk = (id: string, o: Partial<CardModel>): CardModel => ({
    id,
    lane: "nft",
    title: id,
    media: { kind: "monogram", seed: id },
    verified: false,
    seller: { handle: "@x", address: "g1x00000000000000000000000000000000", reputation: null },
    stats: [],
    priceLabel: "0 GNOT",
    href: `#${id}`,
    ...o,
})

const cards = [
    mk("a", { title: "Gnomes Genesis", category: "PFPs", verified: true, priceValue: 12 }),
    mk("b", { title: "Lattice", category: "Art", verified: false, priceValue: 5 }),
    mk("c", { title: "Validator Crest", category: "PFPs", verified: false, priceValue: 40 }),
]

describe("applyFilters", () => {
    it("filters by query across title", () => {
        expect(applyFilters(cards, { ...DEFAULT_FILTERS, q: "latt" }).map((c) => c.id)).toEqual(["b"])
    })
    it("filters by category", () => {
        expect(applyFilters(cards, { ...DEFAULT_FILTERS, category: "PFPs" }).map((c) => c.id)).toEqual(["a", "c"])
    })
    it("filters verifiedOnly", () => {
        expect(applyFilters(cards, { ...DEFAULT_FILTERS, verifiedOnly: true }).map((c) => c.id)).toEqual(["a"])
    })
    it("sorts by price ascending / descending", () => {
        expect(applyFilters(cards, { ...DEFAULT_FILTERS, sort: "price-asc" }).map((c) => c.id)).toEqual(["b", "a", "c"])
        expect(applyFilters(cards, { ...DEFAULT_FILTERS, sort: "price-desc" }).map((c) => c.id)).toEqual(["c", "a", "b"])
    })
    it("does not mutate the input array", () => {
        const before = cards.map((c) => c.id)
        applyFilters(cards, { ...DEFAULT_FILTERS, sort: "price-desc" })
        expect(cards.map((c) => c.id)).toEqual(before)
    })
})

describe("filters URL round-trip", () => {
    it("parse(serialize(f)) preserves filters", () => {
        const f: MarketFilters = { q: "gno", category: "Art", sort: "price-desc", verifiedOnly: true }
        expect(parseFilters(filtersToParams(f))).toEqual(f)
    })
    it("omits defaults from the URL", () => {
        expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("")
    })
    it("preserves unrelated base params", () => {
        const base = new URLSearchParams("tab=nfts")
        const out = filtersToParams({ ...DEFAULT_FILTERS, q: "x" }, base)
        expect(out.get("tab")).toBe("nfts")
        expect(out.get("q")).toBe("x")
    })
})
