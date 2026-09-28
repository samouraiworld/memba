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
            core: { displayName: "Alice Gno", bio: "", location: null, homepage: "", avatar: "" },
            document: defaultProfileDocument(), documentPresent: false, documentProblem: false, missingCore: [],
        }
        const shown = shownProfile(ADDRESS, chain, legacy)
        expect(shown.displayName).toBe("Alice Gno")
        expect(shown.bio).toEqual({ value: "", source: "Gno profile" })
        expect(shown.homepage.value).toBe("")
        expect(shown.title.value).toBe("Builder")
        expect(shown.location.source).toBe("Gnolove")
    })

    it("treats an empty on-chain document as an intentional replacement", () => {
        const chain: ProfileChainRead = {
            core: { displayName: null, bio: null, location: null, homepage: null, avatar: null },
            document: defaultProfileDocument(), documentPresent: true, documentProblem: false, missingCore: [],
        }
        const shown = shownProfile(ADDRESS, chain, legacy)
        expect(shown.title.value).toBe("")
        expect(shown.company.value).toBe("")
        expect(shown.documentPresent).toBe(true)
    })
})
