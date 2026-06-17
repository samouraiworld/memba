/**
 * launchpadReads.test.ts — reads layer over queryRender (mocked) + parsers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const queryRender = vi.fn()
const queryEval = vi.fn()
vi.mock("./dao/shared", () => ({
    queryRender: (...a: unknown[]) => queryRender(...a),
    queryEval: (...a: unknown[]) => queryEval(...a),
}))

import {
    fetchCollectionList,
    fetchCollectionDetail,
    fetchCollectionsByCreator,
    fetchCollectionMeta,
    isCollectionVerified,
} from "./launchpadReads"

const LIST = `# Memba Collections

- **Genesis** (g1abc/genesis) — phase 2, minted 3
- **Art** (g1def/art) — phase 0, minted 0
- **More** (g1abc/more) — phase 1, minted 1

_Page 1 — 3 of 3 collections._
`

beforeEach(() => {
    queryRender.mockReset()
    queryEval.mockReset()
})

describe("launchpadReads", () => {
    it("fetchCollectionList parses Render(\"\") output", async () => {
        queryRender.mockResolvedValue(LIST)
        const rows = await fetchCollectionList()
        expect(rows).toHaveLength(3)
        expect(rows[0].id).toBe("g1abc/genesis")
        // called with empty render path
        expect(queryRender).toHaveBeenCalledWith(expect.any(String), expect.any(String), "")
    })

    it("fetchCollectionList returns [] when Render is null", async () => {
        queryRender.mockResolvedValue(null)
        expect(await fetchCollectionList()).toEqual([])
    })

    it("fetchCollectionDetail queries collection/<id> and parses", async () => {
        queryRender.mockResolvedValue(`# Genesis (GEN)

- ID: \`g1abc/genesis\`
- Creator: g1abc
- Admin: g1abc
- Royalty: 500 bps → g1abc
- Phase: 2
- Mint price: 1000000 ugnot
- Supply: 3 / 100
`)
        const d = await fetchCollectionDetail("g1abc/genesis")
        expect(d?.symbol).toBe("GEN")
        expect(queryRender).toHaveBeenCalledWith(expect.any(String), expect.any(String), "collection/g1abc/genesis")
    })

    it("fetchCollectionDetail returns null on null render", async () => {
        queryRender.mockResolvedValue(null)
        expect(await fetchCollectionDetail("g1/x")).toBeNull()
    })

    it("fetchCollectionsByCreator filters by creator address", async () => {
        queryRender.mockResolvedValue(LIST)
        const mine = await fetchCollectionsByCreator("g1abc")
        expect(mine.map((c) => c.slug)).toEqual(["genesis", "more"])
    })

    it("fetchCollectionMeta parses the qeval string value; null → ''", async () => {
        queryEval.mockResolvedValue(`("true" string)`)
        expect(await fetchCollectionMeta("g1abc/genesis", "verified")).toBe("true")
        expect(queryEval).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            `GetCollectionMeta("g1abc/genesis", "verified")`,
        )
        queryEval.mockResolvedValue(null)
        expect(await fetchCollectionMeta("g1/x", "verified")).toBe("")
    })

    it("isCollectionVerified is true only when meta == 'true'", async () => {
        queryEval.mockResolvedValue(`("true" string)`)
        expect(await isCollectionVerified("g1abc/genesis")).toBe(true)
        queryEval.mockResolvedValue(`("" string)`)
        expect(await isCollectionVerified("g1abc/genesis")).toBe(false)
    })
})
