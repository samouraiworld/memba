import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/dao/chainIdentity", () => ({ assertActiveRpcChain: vi.fn(async () => {}) }))
vi.mock("../../lib/rpcFallback", async (original) => ({
    ...(await original<typeof import("../../lib/rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

import { resilientAbciQuery } from "../../lib/rpcFallback"
import { CORE_FIELDS, defaultProfileDocument, encodeProfileDocument, layoutLocked, parseProfileDocument, parseProfileString, PROFILE_DOCUMENT_FIELD, readProfileOnChain, safeProfileUrl } from "./profileData"

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
        expect(profile.documentUnreadable).toBe(false)
        expect(profile.documentInvalid).toBe(false)
        expect(profile.missingCore).toEqual([])
        expect(profile.invalidCore).toEqual([])
    })

    it("tells a stored value it cannot use from one the chain did not return", async () => {
        q.mockImplementation(async (_path, expression) => {
            if (typeof expression !== "string") return null
            if (expression.includes(PROFILE_DOCUMENT_FIELD)) return literal("{not a layout")
            if (expression.includes(CORE_FIELDS.bio)) return literal("x".repeat(501))
            if (expression.includes(CORE_FIELDS.location)) throw new Error("offline")
            return literal("__memba_profile_absent_7c4d93a3__")
        })
        const profile = await readProfileOnChain(ADDRESS)
        expect(profile.core.bio).toBeNull()
        expect(profile.invalidCore).toEqual(["bio"])
        expect(profile.missingCore).toEqual(["location"])
        expect(profile).toMatchObject({ documentPresent: false, documentInvalid: true, documentUnreadable: false, documentNewer: false, documentOversize: false })
    })

    it("counts an answer too long to decode as a stored value it cannot use, not as no answer", async () => {
        const huge = `("${"x".repeat(24_001)}" string)`
        q.mockImplementation(async (_path, expression) => {
            if (typeof expression !== "string") return null
            if (expression.includes(PROFILE_DOCUMENT_FIELD) || expression.includes(CORE_FIELDS.bio)) return huge
            return literal("__memba_profile_absent_7c4d93a3__")
        })
        const profile = await readProfileOnChain(ADDRESS)
        // A field is replaceable by its owner; a layout that long cannot show its version, so it is locked like a newer one.
        expect(profile).toMatchObject({ invalidCore: ["bio"], missingCore: [], documentOversize: true, documentInvalid: false, documentUnreadable: false, documentNewer: false, documentPresent: false })
        expect(layoutLocked(profile)).toBe(true)
        expect(profile.core.bio).toBeNull()
        // A long answer that is not a string result is still no answer.
        q.mockImplementation(async (_path, expression) => typeof expression === "string" && expression.includes(CORE_FIELDS.bio) ? "x".repeat(24_001) : literal("__memba_profile_absent_7c4d93a3__"))
        expect((await readProfileOnChain(ADDRESS)).missingCore).toEqual(["bio"])
    })

    it("tells a layout saved under a later version from one it cannot read", async () => {
        const stored = (layout: string) => q.mockImplementation(async (_path, expression) => literal(typeof expression === "string" && expression.includes(PROFILE_DOCUMENT_FIELD) ? layout : "__memba_profile_absent_7c4d93a3__"))
        stored(JSON.stringify({ ...defaultProfileDocument(), version: 2, title: "Lead" }))
        const newer = await readProfileOnChain(ADDRESS)
        expect(newer).toMatchObject({ documentNewer: true, documentInvalid: false, documentOversize: false, documentPresent: false, document: defaultProfileDocument() })
        expect(layoutLocked(newer)).toBe(true)
        // Version 1 with a section this version does not know: unreadable here, and its owner's to replace.
        stored(JSON.stringify({ ...defaultProfileDocument(), sections: [...defaultProfileDocument().sections, "events"] }))
        const unknownSection = await readProfileOnChain(ADDRESS)
        expect(unknownSection).toMatchObject({ documentNewer: false, documentInvalid: true, documentPresent: false })
        expect(layoutLocked(unknownSection)).toBe(false)
        stored(JSON.stringify({ version: "2" }))
        expect(await readProfileOnChain(ADDRESS)).toMatchObject({ documentNewer: false, documentInvalid: true })
    })

    it("reports a layout the chain did not return as unreadable, not invalid", async () => {
        q.mockImplementation(async (_path, expression) => {
            if (typeof expression === "string" && expression.includes(PROFILE_DOCUMENT_FIELD)) throw new Error("offline")
            return literal("__memba_profile_absent_7c4d93a3__")
        })
        expect(await readProfileOnChain(ADDRESS)).toMatchObject({ documentUnreadable: true, documentInvalid: false, invalidCore: [] })
    })

    it("rejects invalid addresses before querying the chain", async () => {
        await expect(readProfileOnChain('g1bad"), Evil()')).rejects.toThrow("Invalid profile address")
        expect(q).not.toHaveBeenCalled()
    })
})
