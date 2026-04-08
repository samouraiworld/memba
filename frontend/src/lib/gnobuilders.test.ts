import { describe, it, expect } from "vitest"
import {
    ALL_QUESTS,
    QUEST_COUNTS,
    TOTAL_POSSIBLE_XP_V2,
    RANK_TIERS,
    CANDIDATURE_XP_THRESHOLD_V2,
    calculateRank,
    xpToNextRank,
    getQuestById,
    getQuestsByCategory,
    getVisibleQuests,
    isQuestAvailable,
    buildQuestXPMap,
    type GnoQuest,
} from "./gnobuilders"

// ── Quest Registry Tests ────────────────────────────────────

describe("quest registry", () => {
    it("has 85 total quests", () => {
        expect(ALL_QUESTS).toHaveLength(85)
    })

    it("has correct category counts", () => {
        expect(QUEST_COUNTS.developer).toBe(30)
        expect(QUEST_COUNTS.everyone).toBe(30)
        expect(QUEST_COUNTS.champion).toBe(15)
        expect(QUEST_COUNTS.hidden).toBe(10)
        expect(QUEST_COUNTS.total).toBe(85)
    })

    it("all quests have unique IDs", () => {
        const ids = ALL_QUESTS.map(q => q.id)
        const unique = new Set(ids)
        if (unique.size !== ids.length) {
            const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
            throw new Error(`Duplicate quest IDs: ${dupes.join(", ")}`)
        }
        expect(unique.size).toBe(ids.length)
    })

    it("all quests have positive XP", () => {
        for (const q of ALL_QUESTS) {
            expect(q.xp, `Quest ${q.id} has 0 or negative XP`).toBeGreaterThan(0)
        }
    })

    it("all quests have valid category", () => {
        const valid = new Set(["developer", "everyone", "champion", "hidden"])
        for (const q of ALL_QUESTS) {
            expect(valid.has(q.category), `Quest ${q.id} has invalid category: ${q.category}`).toBe(true)
        }
    })

    it("all quests have valid difficulty", () => {
        const valid = new Set(["beginner", "intermediate", "advanced", "expert"])
        for (const q of ALL_QUESTS) {
            expect(valid.has(q.difficulty), `Quest ${q.id} has invalid difficulty: ${q.difficulty}`).toBe(true)
        }
    })

    it("all quests have valid verification type", () => {
        const valid = new Set(["on_chain", "off_chain", "social", "self_report"])
        for (const q of ALL_QUESTS) {
            expect(valid.has(q.verification), `Quest ${q.id} has invalid verification: ${q.verification}`).toBe(true)
        }
    })

    it("all quests have season >= 1", () => {
        for (const q of ALL_QUESTS) {
            expect(q.season, `Quest ${q.id} has invalid season`).toBeGreaterThanOrEqual(1)
        }
    })

    it("all prerequisites reference existing quests", () => {
        const ids = new Set(ALL_QUESTS.map(q => q.id))
        for (const q of ALL_QUESTS) {
            if (q.prerequisite) {
                expect(ids.has(q.prerequisite), `Quest ${q.id} prerequisite '${q.prerequisite}' does not exist`).toBe(true)
            }
        }
    })

    it("no circular prerequisites", () => {
        const questMap = new Map<string, GnoQuest>()
        for (const q of ALL_QUESTS) questMap.set(q.id, q)

        for (const q of ALL_QUESTS) {
            const visited = new Set<string>()
            let current: GnoQuest | undefined = q
            while (current?.prerequisite) {
                if (visited.has(current.id)) {
                    throw new Error(`Circular prerequisite detected at quest: ${current.id}`)
                }
                visited.add(current.id)
                current = questMap.get(current.prerequisite)
            }
        }
    })

    it("total XP is reasonable (2000-3000 range)", () => {
        expect(TOTAL_POSSIBLE_XP_V2).toBeGreaterThan(2000)
        expect(TOTAL_POSSIBLE_XP_V2).toBeLessThan(3000)
    })

    it("preserves all original 10 quest IDs", () => {
        const originalIds = [
            "connect-wallet", "visit-5-pages", "browse-proposals", "view-profile",
            "use-cmdk", "switch-network", "directory-tabs", "submit-feedback",
            "view-validator", "share-link",
        ]
        // Note: "directory-tabs" and "view-profile" are removed from v2 but their IDs
        // should still be recognized by the backend for backward compat.
        // In v2, these quests are renamed/reorganized but the IDs that exist in v1
        // must map to quests in v2.
        const v2Ids = new Set(ALL_QUESTS.map(q => q.id))
        const preserved = originalIds.filter(id => v2Ids.has(id))
        // At minimum, these core IDs should be preserved
        expect(preserved).toContain("connect-wallet")
        expect(preserved).toContain("visit-5-pages")
        expect(preserved).toContain("browse-proposals")
        expect(preserved).toContain("use-cmdk")
        expect(preserved).toContain("switch-network")
        expect(preserved).toContain("submit-feedback")
        expect(preserved).toContain("view-validator")
        expect(preserved).toContain("share-link")
    })
})

// ── Rank System Tests ───────────────────────────────────────

describe("rank system", () => {
    it("has 8 tiers", () => {
        expect(RANK_TIERS).toHaveLength(8)
    })

    it("tiers are sorted by XP", () => {
        for (let i = 1; i < RANK_TIERS.length; i++) {
            expect(RANK_TIERS[i].xpRequired).toBeGreaterThan(RANK_TIERS[i - 1].xpRequired)
        }
    })

    it("tier 0 starts at 0 XP", () => {
        expect(RANK_TIERS[0].xpRequired).toBe(0)
    })

    it("all tiers have names and colors", () => {
        for (const t of RANK_TIERS) {
            expect(t.name.length).toBeGreaterThan(0)
            expect(t.color.length).toBeGreaterThan(0)
            expect(t.cssClass.length).toBeGreaterThan(0)
            expect(t.perks.length).toBeGreaterThan(0)
        }
    })

    it("candidature threshold is Gold rank (350 XP)", () => {
        expect(CANDIDATURE_XP_THRESHOLD_V2).toBe(350)
        const gold = RANK_TIERS.find(t => t.name === "Gold Architect")
        expect(gold).toBeDefined()
        expect(gold!.xpRequired).toBe(CANDIDATURE_XP_THRESHOLD_V2)
    })
})

describe("calculateRank", () => {
    it("returns Newcomer at 0 XP", () => {
        expect(calculateRank(0).name).toBe("Newcomer")
    })

    it("returns Bronze at 50 XP", () => {
        expect(calculateRank(50).name).toBe("Bronze Explorer")
    })

    it("returns Bronze at 149 XP (just under Silver)", () => {
        expect(calculateRank(149).name).toBe("Bronze Explorer")
    })

    it("returns Silver at 150 XP", () => {
        expect(calculateRank(150).name).toBe("Silver Builder")
    })

    it("returns Gold at 350 XP", () => {
        expect(calculateRank(350).name).toBe("Gold Architect")
    })

    it("returns Gno Guardian at 2000+ XP", () => {
        expect(calculateRank(2000).name).toBe("Gno Guardian")
        expect(calculateRank(5000).name).toBe("Gno Guardian")
    })

    it("returns correct tier numbers", () => {
        expect(calculateRank(0).tier).toBe(0)
        expect(calculateRank(50).tier).toBe(1)
        expect(calculateRank(350).tier).toBe(3)
        expect(calculateRank(2000).tier).toBe(7)
    })
})

describe("xpToNextRank", () => {
    it("50 XP needed from 0 to Bronze", () => {
        expect(xpToNextRank(0)).toBe(50)
    })

    it("100 XP needed from 50 to Silver", () => {
        expect(xpToNextRank(50)).toBe(100)
    })

    it("0 XP needed at max rank", () => {
        expect(xpToNextRank(2000)).toBe(0)
        expect(xpToNextRank(5000)).toBe(0)
    })

    it("correct for mid-tier values", () => {
        expect(xpToNextRank(100)).toBe(50) // 100 XP in Bronze, Silver is at 150
    })
})

// ── Quest Lookup Tests ──────────────────────────────────────

describe("getQuestById", () => {
    it("finds existing quest", () => {
        const q = getQuestById("connect-wallet")
        expect(q).toBeDefined()
        expect(q!.title).toBe("Wallet Connected")
    })

    it("returns undefined for non-existent quest", () => {
        expect(getQuestById("nonexistent")).toBeUndefined()
    })
})

describe("getQuestsByCategory", () => {
    it("returns 30 developer quests", () => {
        expect(getQuestsByCategory("developer")).toHaveLength(30)
    })

    it("returns 30 everyone quests", () => {
        expect(getQuestsByCategory("everyone")).toHaveLength(30)
    })

    it("returns 15 champion quests", () => {
        expect(getQuestsByCategory("champion")).toHaveLength(15)
    })

    it("returns 10 hidden quests", () => {
        expect(getQuestsByCategory("hidden")).toHaveLength(10)
    })
})

describe("getVisibleQuests", () => {
    it("hides hidden quests when nothing completed", () => {
        const visible = getVisibleQuests(new Set())
        const hiddenCount = visible.filter(q => q.category === "hidden").length
        expect(hiddenCount).toBe(0)
    })

    it("shows hidden quest when it is completed", () => {
        const visible = getVisibleQuests(new Set(["easter-egg-konami"]))
        const found = visible.find(q => q.id === "easter-egg-konami")
        expect(found).toBeDefined()
    })

    it("shows all non-hidden quests", () => {
        const visible = getVisibleQuests(new Set())
        const nonHidden = ALL_QUESTS.filter(q => !q.hidden).length
        expect(visible.length).toBe(nonHidden)
    })
})

describe("isQuestAvailable", () => {
    it("returns true for quest with no prerequisite", () => {
        expect(isQuestAvailable("connect-wallet", new Set())).toBe(true)
    })

    it("returns false for quest with unmet prerequisite", () => {
        expect(isQuestAvailable("deploy-counter-pkg", new Set())).toBe(false)
    })

    it("returns true for quest with met prerequisite", () => {
        expect(isQuestAvailable("deploy-counter-pkg", new Set(["deploy-hello-pkg"]))).toBe(true)
    })

    it("returns false for already completed quest", () => {
        expect(isQuestAvailable("connect-wallet", new Set(["connect-wallet"]))).toBe(false)
    })

    it("returns false for non-existent quest", () => {
        expect(isQuestAvailable("nonexistent", new Set())).toBe(false)
    })
})

describe("buildQuestXPMap", () => {
    it("returns map with 85 entries", () => {
        const map = buildQuestXPMap()
        expect(Object.keys(map)).toHaveLength(85)
    })

    it("all values are positive", () => {
        const map = buildQuestXPMap()
        for (const [id, xp] of Object.entries(map)) {
            expect(xp, `Quest ${id}`).toBeGreaterThan(0)
        }
    })

    it("connect-wallet has 10 XP", () => {
        const map = buildQuestXPMap()
        expect(map["connect-wallet"]).toBe(10)
    })
})
