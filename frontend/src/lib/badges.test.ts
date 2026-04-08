import { describe, it, expect } from "vitest"
import {
    BADGE_REALM_PATH,
    getRankBadgeLabel,
    hasBadgeForQuest,
    getMintableBadges,
    getMintableRankBadges,
    type BadgeInfo,
} from "./badges"

describe("badge constants", () => {
    it("badge realm path is correct", () => {
        expect(BADGE_REALM_PATH).toBe("gno.land/r/samcrew/gnobuilders_badges")
    })
})

describe("getRankBadgeLabel", () => {
    it("returns correct names for valid tiers", () => {
        expect(getRankBadgeLabel(0)).toBe("Newcomer")
        expect(getRankBadgeLabel(1)).toBe("Bronze Explorer")
        expect(getRankBadgeLabel(3)).toBe("Gold Architect")
        expect(getRankBadgeLabel(7)).toBe("Gno Guardian")
    })

    it("returns Unknown for invalid tier", () => {
        expect(getRankBadgeLabel(99)).toBe("Unknown Rank")
    })
})

describe("hasBadgeForQuest", () => {
    it("returns true for completed quest", () => {
        expect(hasBadgeForQuest("connect-wallet", new Set(["connect-wallet"]))).toBe(true)
    })

    it("returns false for uncompleted quest", () => {
        expect(hasBadgeForQuest("connect-wallet", new Set())).toBe(false)
    })
})

describe("getMintableBadges", () => {
    it("returns quests completed but not minted", () => {
        const completed = new Set(["connect-wallet", "visit-5-pages", "use-cmdk"])
        const owned: BadgeInfo[] = [
            { tokenId: "g1:connect-wallet", questId: "connect-wallet", owner: "g1", tokenUri: "", soulbound: false, mintedAt: 0 },
        ]
        const mintable = getMintableBadges(completed, owned)
        expect(mintable).toHaveLength(2)
        expect(mintable).toContain("visit-5-pages")
        expect(mintable).toContain("use-cmdk")
    })

    it("returns empty when all are minted", () => {
        const completed = new Set(["connect-wallet"])
        const owned: BadgeInfo[] = [
            { tokenId: "g1:connect-wallet", questId: "connect-wallet", owner: "g1", tokenUri: "", soulbound: false, mintedAt: 0 },
        ]
        expect(getMintableBadges(completed, owned)).toHaveLength(0)
    })

    it("returns empty with no completions", () => {
        expect(getMintableBadges(new Set(), [])).toHaveLength(0)
    })
})

describe("getMintableRankBadges", () => {
    it("returns all unminted ranks up to current", () => {
        // 350 XP = Gold (tier 3)
        const mintable = getMintableRankBadges(350, [])
        expect(mintable).toEqual([1, 2, 3])
    })

    it("skips already minted ranks", () => {
        const owned: BadgeInfo[] = [
            { tokenId: "g1:rank:1", questId: "rank:1", owner: "g1", tokenUri: "", soulbound: true, mintedAt: 0 },
        ]
        const mintable = getMintableRankBadges(350, owned)
        expect(mintable).toEqual([2, 3])
    })

    it("returns empty at tier 0", () => {
        expect(getMintableRankBadges(0, [])).toHaveLength(0)
    })

    it("returns empty when all minted", () => {
        const owned: BadgeInfo[] = [
            { tokenId: "g1:rank:1", questId: "rank:1", owner: "g1", tokenUri: "", soulbound: true, mintedAt: 0 },
        ]
        const mintable = getMintableRankBadges(50, owned) // tier 1
        expect(mintable).toHaveLength(0)
    })
})
