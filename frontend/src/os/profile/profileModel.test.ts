import { describe, expect, it } from "vitest"
import type { UserProfile } from "../../lib/profile"
import { defaultProfileDocument, type ProfileChainRead } from "./profileData"
import { shownProfile } from "./profileModel"

const ADDRESS = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const legacy = {
    username: "@alice", bio: "Backend bio", title: "Builder", company: "Studio", avatarUrl: "",
    githubBio: "GitHub bio", githubLocation: "Paris", githubAvatar: "",
    socialLinks: { twitter: "alice", github: "alice", website: "https://example.org" },
    governanceVotes: [], deployedPackages: [],
} as unknown as UserProfile

describe("source-aware public profile", () => {
    it("uses on-chain clear values instead of restoring legacy content", () => {
        const chain: ProfileChainRead = {
            core: { displayName: "Alice Gno", bio: "On-chain bio", location: null, homepage: "", avatar: "" },
            document: defaultProfileDocument(), documentPresent: false, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [],
        }
        const shown = shownProfile(ADDRESS, chain, legacy)
        expect(shown.displayName).toBe("Alice Gno")
        expect(shown.bio).toEqual({ value: "On-chain bio", source: "Gno profile" })
        expect(shown.homepage).toEqual({ value: "", source: "Gno profile" })
        expect(shown.title.value).toBe("Builder")
        expect(shown.location.source).toBe("Gnolove")
    })

    it("keeps the legacy bio when the chain holds only the empty Bio that wallet activation writes", () => {
        const chain: ProfileChainRead = {
            core: { displayName: null, bio: "", location: null, homepage: null, avatar: null },
            document: defaultProfileDocument(), documentPresent: false, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [],
        }
        expect(shownProfile(ADDRESS, chain, legacy).bio).toEqual({ value: "Backend bio", source: "Memba legacy" })
    })

    it("an empty Bio with no earlier bio shows as empty, from no source", () => {
        const chain: ProfileChainRead = {
            core: { displayName: null, bio: "", location: null, homepage: null, avatar: null },
            document: defaultProfileDocument(), documentPresent: false, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [],
        }
        expect(shownProfile(ADDRESS, chain, null).bio).toEqual({ value: "", source: "None" })
    })

    it("flags what it could not read or show, field by field and for the layout", () => {
        const clean: ProfileChainRead = {
            core: { displayName: "Alice", bio: "Hi", location: null, homepage: null, avatar: null },
            document: defaultProfileDocument(), documentPresent: false, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [],
        }
        const flags = (chain: ProfileChainRead | null) => { const shown = shownProfile(ADDRESS, chain, legacy); return [shown.chainProblem, shown.documentProblem] }
        expect(flags(clean)).toEqual([false, false])
        expect(flags(null)).toEqual([true, false])
        expect(flags({ ...clean, missingCore: ["location"] })).toEqual([true, false])
        expect(flags({ ...clean, invalidCore: ["bio"] })).toEqual([true, false])
        expect(flags({ ...clean, documentUnreadable: true })).toEqual([false, true])
        expect(flags({ ...clean, documentInvalid: true })).toEqual([false, true])
        expect(flags({ ...clean, documentNewer: true })).toEqual([false, true])
        expect(flags({ ...clean, documentOversize: true })).toEqual([false, true])
    })

    it("treats an empty on-chain document as an intentional replacement", () => {
        const chain: ProfileChainRead = {
            core: { displayName: null, bio: null, location: null, homepage: null, avatar: null },
            document: defaultProfileDocument(), documentPresent: true, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [],
        }
        const shown = shownProfile(ADDRESS, chain, legacy)
        expect(shown.title.value).toBe("")
        expect(shown.company.value).toBe("")
        expect(shown.documentPresent).toBe(true)
    })
})
