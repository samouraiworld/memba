import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/dao/chainIdentity", () => ({ assertActiveRpcChain: vi.fn(async () => {}) }))
vi.mock("../../lib/rpcFallback", async (original) => ({
    ...(await original<typeof import("../../lib/rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

import { resilientAbciQuery } from "../../lib/rpcFallback"
import { CORE_FIELDS, defaultProfileDocument, encodeProfileDocument, parseProfileDocument, parseProfileString, PROFILE_DOCUMENT_FIELD, readProfileOnChain, safeProfileUrl } from "./profileData"

const ADDRESS = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const q = vi.mocked(resilientAbciQuery)
const literal = (value: string) => `(${JSON.stringify(value)} string)`

describe("public on-chain profile", () => {
    beforeEach(() => q.mockReset())

    it("accepts only bounded presentation data and safe https URLs", () => {
        const document = { ...defaultProfileDocument("builder"), title: "Designer", links: [{ label: "Work", url: "https://example.org/" }] }
        expect(parseProfileDocument(encodeProfileDocument(document))).toEqual(document)
        expect(parseProfileDocument(JSON.stringify({ ...document, accent: "url(javascript:evil)" }))).toBeNull()
        expect(parseProfileDocument(JSON.stringify({ ...document, links: [{ label: "Bad", url: "javascript:alert(1)" }] }))).toBeNull()
        expect(parseProfileDocument(JSON.stringify({ ...document, sections: ["about", "about"] }))).toBeNull()
        expect(parseProfileDocument("x".repeat(4097))).toBeNull()
        expect(safeProfileUrl("https://user:pass@example.org/")).toBeNull()
        expect(safeProfileUrl("http://example.org/")).toBeNull()
    })

    it("decodes live Gno qeval strings, including Unicode not accepted by JSON.parse", () => {
        expect(parseProfileString('("🪷" string)')).toBe("🪷")
        expect(parseProfileString(String.raw`("\U0001fae9" string)`)).toBe(String.fromCodePoint(0x1fae9))
        expect(parseProfileString('(true bool)')).toBeNull()
    })

    it("keeps unset fields distinct from fields deliberately cleared on chain", async () => {
        q.mockImplementation(async (_path, expression) => {
            if (typeof expression !== "string") return null
            if (expression.includes(PROFILE_DOCUMENT_FIELD)) return literal("__memba_profile_absent_7c4d93a3__")
            if (expression.includes(CORE_FIELDS.bio)) return literal("")
            return literal("__memba_profile_absent_7c4d93a3__")
        })
        const profile = await readProfileOnChain(ADDRESS)
        expect(q.mock.calls.slice(0, 6).every(([, expression]) => expression.includes(ADDRESS))).toBe(true)
        expect(profile.core.bio).toBe("")
        expect(profile.core.displayName).toBeNull()
        expect(profile.documentPresent).toBe(false)
        expect(profile.documentProblem).toBe(false)
        expect(profile.missingCore).toEqual([])
    })

    it("rejects invalid addresses before querying the chain", async () => {
        await expect(readProfileOnChain('g1bad"), Evil()')).rejects.toThrow("Invalid profile address")
        expect(q).not.toHaveBeenCalled()
    })
})
