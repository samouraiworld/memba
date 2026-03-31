import { describe, it, expect } from "vitest"
import { parseListings } from "./queries"

describe("parseListings", () => {
    it("parses markdown table into listings", () => {
        const raw = `# Marketplace

| id | type | title | creator | status | price |
|----|------|-------|---------|--------|-------|
| 1 | service | Web Development | g1creator1 | active | 5000000 |
| 2 | agent | Code Review Bot | g1creator2 | paused | 1000000 |
`
        const listings = parseListings(raw)
        expect(listings).toHaveLength(2)
        expect(listings[0].id).toBe("1")
        expect(listings[0].type).toBe("service")
        expect(listings[0].title).toBe("Web Development")
        expect(listings[0].creator).toBe("g1creator1")
        expect(listings[0].status).toBe("active")
        expect(listings[0].pricing.amount).toBe(5000000n)
    })

    it("returns empty array for empty input", () => {
        expect(parseListings("")).toEqual([])
    })

    it("returns empty array for header-only table", () => {
        const raw = `| id | type | title | creator | status | price |
|----|----|-------|---------|--------|-------|`
        expect(parseListings(raw)).toEqual([])
    })

    it("skips lines with insufficient columns", () => {
        const raw = `| 1 | service |
| 2 | agent | Full Row | g1addr | active | 100 |`
        const listings = parseListings(raw)
        expect(listings).toHaveLength(1)
        expect(listings[0].id).toBe("2")
    })

    it("defaults to service type for unknown types", () => {
        const raw = `| 1 | unknown_type | Title | g1addr | active | 100 |`
        const listings = parseListings(raw)
        expect(listings[0].type).toBe("unknown_type")
    })

    it("sets default denom to ugnot", () => {
        const raw = `| 1 | service | Title | g1addr | active | 100 |`
        const listings = parseListings(raw)
        expect(listings[0].pricing.denom).toBe("ugnot")
    })
})
