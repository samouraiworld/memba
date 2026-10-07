import { describe, expect, it } from "vitest"
import type { BasenameTextKey, PrimaryBasename } from "../../../lib/chain/evm/basenames"
import { defaultProfileDocument, encodeProfileDocument } from "../profileData"
import { basenameChainRead, basenameLinks } from "./basenameProfile"

const PRIMARY: PrimaryBasename = {
    name: "jesse.base.eth",
    node: "0x286c3ecf9d29c1d2cc5b4606d9f2164c4a6f069f8edcc0bb406b838b69856509",
    resolver: "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD",
}
const texts = (over: Partial<Record<BasenameTextKey, string | null>> = {}): Record<BasenameTextKey, string | null> => ({
    description: "", avatar: "", url: "", location: "", "com.twitter": "", "com.github": "", "memba.profile.v1": "", ...over,
})

describe("basenameChainRead", () => {
    it("maps the name and the ENSIP-5 records onto the profile fields", () => {
        const read = basenameChainRead(PRIMARY, texts({ description: "base.eth builder #001", avatar: "https://x.test/a.png", url: "https://base.org", location: "Internet" }))
        expect(read.core).toEqual({
            displayName: "jesse.base.eth", bio: "base.eth builder #001", avatar: "https://x.test/a.png", homepage: "https://base.org", location: "Internet",
        })
        expect(read).toMatchObject({ missingCore: [], invalidCore: [], documentPresent: false, documentUnreadable: false, documentInvalid: false })
    })

    it("reads the layout document from the memba.profile.v1 record, the same JSON as on Gno", () => {
        const document = { ...defaultProfileDocument(), title: "Builder", company: "Base" }
        const read = basenameChainRead(PRIMARY, texts({ "memba.profile.v1": encodeProfileDocument(document) }))
        expect(read.documentPresent).toBe(true)
        expect(read.document).toMatchObject({ title: "Builder", company: "Base" })
    })

    it("flags a malformed, a newer and an unread layout without applying it", () => {
        expect(basenameChainRead(PRIMARY, texts({ "memba.profile.v1": "{nope" }))).toMatchObject({ documentInvalid: true, documentPresent: false })
        expect(basenameChainRead(PRIMARY, texts({ "memba.profile.v1": '{"version":2}' }))).toMatchObject({ documentNewer: true, documentInvalid: false })
        expect(basenameChainRead(PRIMARY, texts({ "memba.profile.v1": null }))).toMatchObject({ documentUnreadable: true })
    })

    it("separates unset (empty), failed (missing) and over-limit (invalid) records", () => {
        const read = basenameChainRead(PRIMARY, texts({ description: "x".repeat(501), url: null }))
        expect(read.core.bio).toBeNull()
        expect(read.invalidCore).toEqual(["bio"])
        expect(read.missingCore).toEqual(["homepage"])
        expect(read.core.location).toBeNull()
    })

    it("gives an account without a Basename an empty profile with nothing missing", () => {
        const read = basenameChainRead(null, null)
        expect(Object.values(read.core).every((v) => v === null)).toBe(true)
        expect(read).toMatchObject({ missingCore: [], invalidCore: [], documentUnreadable: false, documentPresent: false })
    })

    it("marks every text field missing when the records could not be read", () => {
        expect(basenameChainRead(PRIMARY, null).missingCore).toEqual(["bio", "avatar", "homepage", "location"])
    })
})

describe("basenameLinks", () => {
    it("builds X and GitHub links from handles or https URLs, and drops anything unsafe", () => {
        expect(basenameLinks(texts({ "com.twitter": "@jessepollak", "com.github": "https://github.com/jessepollak" }))).toEqual([
            { label: "X", url: "https://x.com/jessepollak" },
            { label: "GitHub", url: "https://github.com/jessepollak" },
        ])
        expect(basenameLinks(texts({ "com.twitter": "javascript:alert(1) x" }))).toEqual([])
        expect(basenameLinks(null)).toEqual([])
    })
})
