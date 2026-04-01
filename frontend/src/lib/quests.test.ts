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
    it("candidature threshold is 100", () => expect(CANDIDATURE_XP_THRESHOLD).toBe(100))
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
        const state = completeQuest("connect-wallet")
        expect(state).not.toBeNull()
        expect(state!.totalXP).toBe(10)
        expect(state!.completed).toHaveLength(1)
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
        const state = completeQuest("browse-proposals") // 15
        expect(state!.totalXP).toBe(25)
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
    it("true after enough quests", () => {
        // Complete quests worth >= 100 XP
        completeQuest("connect-wallet")    // 10
        completeQuest("visit-5-pages")     // 10
        completeQuest("browse-proposals")  // 15
        completeQuest("view-profile")      // 10
        completeQuest("use-cmdk")          // 10
        completeQuest("switch-network")    // 15
        completeQuest("directory-tabs")    // 15
        completeQuest("submit-feedback")   // 20 → total 105
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
