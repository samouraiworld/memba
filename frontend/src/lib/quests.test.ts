import { describe, it, expect, beforeEach } from "vitest"
import {
    QUESTS,
    CANDIDATURE_XP_THRESHOLD,
    TOTAL_POSSIBLE_XP,
    loadQuestProgress,
    completeQuest,
    isQuestCompleted,
    canApplyForMembership,
    getCompletionPercent,
    trackPageVisit,
    trackDirectoryTab,
} from "./quests"

beforeEach(() => {
    localStorage.clear()
})

describe("quest definitions", () => {
    it("has 10 quests", () => expect(QUESTS).toHaveLength(10))
    it("total XP is 125", () => expect(TOTAL_POSSIBLE_XP).toBe(125))
    it("candidature threshold is 350 (Gold rank)", () => expect(CANDIDATURE_XP_THRESHOLD).toBe(350))
    it("all quests have unique IDs", () => {
        const ids = QUESTS.map(q => q.id)
        expect(new Set(ids).size).toBe(ids.length)
    })
    it("all quests have positive XP", () => {
        for (const q of QUESTS) expect(q.xp).toBeGreaterThan(0)
    })
})

describe("loadQuestProgress", () => {
    it("returns empty state initially", () => {
        const state = loadQuestProgress()
        expect(state.completed).toEqual([])
        expect(state.totalXP).toBe(0)
    })
})

describe("completeQuest", () => {
    it("completes a quest and adds XP", () => {
        const result = completeQuest("connect-wallet")
        expect(result).not.toBeNull()
        expect(result!.state.totalXP).toBe(10)
        expect(result!.state.completed).toHaveLength(1)
        expect(result!.unlockedCandidature).toBe(false)
    })

    it("returns null for already completed quest", () => {
        completeQuest("connect-wallet")
        expect(completeQuest("connect-wallet")).toBeNull()
    })

    it("returns null for unknown quest", () => {
        expect(completeQuest("nonexistent")).toBeNull()
    })

    it("accumulates XP across quests", () => {
        completeQuest("connect-wallet") // 10
        const result = completeQuest("browse-proposals") // 15
        expect(result!.state.totalXP).toBe(25)
    })

    it("does not flag unlockedCandidature below 350 XP threshold", () => {
        // With only 10 v1 quests (125 XP max), can't reach 350 threshold
        completeQuest("connect-wallet")    // 10
        completeQuest("visit-5-pages")     // 10
        completeQuest("browse-proposals")  // 15
        completeQuest("view-profile")      // 10
        completeQuest("use-cmdk")          // 10
        completeQuest("switch-network")    // 15
        completeQuest("directory-tabs")    // 15 → 85
        const result = completeQuest("submit-feedback") // 20 → 105
        // 105 XP < 350 threshold, so candidature not unlocked
        expect(result!.unlockedCandidature).toBe(false)
    })
})

describe("isQuestCompleted", () => {
    it("false initially", () => expect(isQuestCompleted("connect-wallet")).toBe(false))
    it("true after completion", () => {
        completeQuest("connect-wallet")
        expect(isQuestCompleted("connect-wallet")).toBe(true)
    })
})

describe("canApplyForMembership", () => {
    it("false with 0 XP", () => expect(canApplyForMembership()).toBe(false))
    it("false with 125 XP (below 350 threshold)", () => {
        // Complete all v1 quests = 125 XP, still below 350
        completeQuest("connect-wallet")    // 10
        completeQuest("visit-5-pages")     // 10
        completeQuest("browse-proposals")  // 15
        completeQuest("view-profile")      // 10
        completeQuest("use-cmdk")          // 10
        completeQuest("switch-network")    // 15
        completeQuest("directory-tabs")    // 15
        completeQuest("submit-feedback")   // 20
        completeQuest("view-validator")    // 10
        completeQuest("share-link")        // 10 → total 125
        // 125 < 350, not eligible unless grandfathered
        expect(canApplyForMembership()).toBe(false)
    })

    it("true with legacy eligibility flag", () => {
        // Set legacy flag (simulating a user who had 100+ XP before v4.0)
        localStorage.setItem("memba_legacy_candidature_eligible", "true")
        completeQuest("connect-wallet")    // 10
        completeQuest("visit-5-pages")     // 10
        completeQuest("browse-proposals")  // 15
        completeQuest("view-profile")      // 10
        completeQuest("use-cmdk")          // 10
        completeQuest("switch-network")    // 15
        completeQuest("directory-tabs")    // 15
        completeQuest("submit-feedback")   // 20 → total 105
        // 105 >= 100 (legacy) AND legacy flag set → eligible
        expect(canApplyForMembership()).toBe(true)
    })
})

describe("getCompletionPercent", () => {
    it("0% initially", () => expect(getCompletionPercent()).toBe(0))
    it("10% after 1 quest", () => {
        completeQuest("connect-wallet")
        expect(getCompletionPercent()).toBe(10)
    })
})

describe("trackPageVisit", () => {
    it("completes quest after 5 unique pages", () => {
        trackPageVisit("dao")
        trackPageVisit("tokens")
        trackPageVisit("validators")
        trackPageVisit("directory")
        expect(isQuestCompleted("visit-5-pages")).toBe(false)
        trackPageVisit("profile")
        expect(isQuestCompleted("visit-5-pages")).toBe(true)
    })

    it("ignores duplicate visits", () => {
        trackPageVisit("dao")
        trackPageVisit("dao")
        trackPageVisit("dao")
        expect(isQuestCompleted("visit-5-pages")).toBe(false)
    })
})

describe("trackDirectoryTab", () => {
    it("completes quest after 3 tabs", () => {
        trackDirectoryTab("daos")
        trackDirectoryTab("tokens")
        expect(isQuestCompleted("directory-tabs")).toBe(false)
        trackDirectoryTab("packages")
        expect(isQuestCompleted("directory-tabs")).toBe(true)
    })
})
