import { describe, it, expect, beforeEach, vi } from "vitest"
import {
    verifyQuest,
    verifyDeployment,
    trackAIReportView,
    trackDailyLogin,
    trackNetworkVisit,
    setupKonamiDetector,
    type QuestVerificationResult,
} from "./questVerifier"

beforeEach(() => {
    localStorage.clear()
})

// ── Tracking Helpers ────────────────────────────────────────

describe("trackAIReportView", () => {
    const addr = "g1testaddr"

    it("tracks unique DAO reports", () => {
        trackAIReportView(addr, "gno.land/r/dao1")
        trackAIReportView(addr, "gno.land/r/dao2")
        trackAIReportView(addr, "gno.land/r/dao3")

        const raw = localStorage.getItem(`memba_quest_ai_reports_${addr}`)
        const reports = JSON.parse(raw!)
        expect(reports).toHaveLength(3)
    })

    it("deduplicates same DAO", () => {
        trackAIReportView(addr, "gno.land/r/dao1")
        trackAIReportView(addr, "gno.land/r/dao1")
        trackAIReportView(addr, "gno.land/r/dao1")

        const raw = localStorage.getItem(`memba_quest_ai_reports_${addr}`)
        const reports = JSON.parse(raw!)
        expect(reports).toHaveLength(1)
    })

    it("does nothing for empty address", () => {
        trackAIReportView("", "gno.land/r/dao1")
        expect(localStorage.length).toBe(0)
    })
})

describe("trackDailyLogin", () => {
    const addr = "g1testaddr"

    it("starts streak at 1", () => {
        trackDailyLogin(addr)

        const raw = localStorage.getItem(`memba_quest_login_streak_${addr}`)
        const data = JSON.parse(raw!)
        expect(data.streak).toBe(1)
        expect(data.dates).toHaveLength(1)
    })

    it("ignores duplicate same-day login", () => {
        trackDailyLogin(addr)
        trackDailyLogin(addr)

        const raw = localStorage.getItem(`memba_quest_login_streak_${addr}`)
        const data = JSON.parse(raw!)
        expect(data.streak).toBe(1)
        expect(data.dates).toHaveLength(1)
    })

    it("does nothing for empty address", () => {
        trackDailyLogin("")
        expect(localStorage.length).toBe(0)
    })
})

describe("trackNetworkVisit", () => {
    const addr = "g1testaddr"

    it("tracks unique networks", () => {
        trackNetworkVisit(addr, "test12")
        trackNetworkVisit(addr, "test11")
        trackNetworkVisit(addr, "gnoland1")

        const raw = localStorage.getItem(`memba_quest_networks_${addr}`)
        const networks = JSON.parse(raw!)
        expect(networks).toHaveLength(3)
        expect(networks).toContain("test12")
        expect(networks).toContain("test11")
        expect(networks).toContain("gnoland1")
    })

    it("deduplicates same network", () => {
        trackNetworkVisit(addr, "test12")
        trackNetworkVisit(addr, "test12")

        const raw = localStorage.getItem(`memba_quest_networks_${addr}`)
        const networks = JSON.parse(raw!)
        expect(networks).toHaveLength(1)
    })

    it("does nothing for empty address", () => {
        trackNetworkVisit("", "test12")
        expect(localStorage.length).toBe(0)
    })
})

describe("setupKonamiDetector", () => {
    it("detects konami code", () => {
        const callback = vi.fn()
        const cleanup = setupKonamiDetector(callback)

        const keys = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]
        for (const key of keys) {
            window.dispatchEvent(new KeyboardEvent("keydown", { key }))
        }

        expect(callback).toHaveBeenCalledOnce()
        cleanup()
    })

    it("resets on wrong key", () => {
        const callback = vi.fn()
        const cleanup = setupKonamiDetector(callback)

        // Start correct, then wrong
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }))
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }))
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" })) // wrong
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))

        expect(callback).not.toHaveBeenCalled()
        cleanup()
    })

    it("cleanup removes listener", () => {
        const callback = vi.fn()
        const cleanup = setupKonamiDetector(callback)
        cleanup()

        const keys = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]
        for (const key of keys) {
            window.dispatchEvent(new KeyboardEvent("keydown", { key }))
        }

        expect(callback).not.toHaveBeenCalled()
    })
})

// ── Core verifyQuest Tests ───────────────────────────────────

describe("verifyQuest", () => {
    it("returns error for unknown quest ID", async () => {
        const result = await verifyQuest("nonexistent-quest", "g1test", "http://rpc")
        expect(result.status).toBe("error")
        expect(result.message).toContain("Unknown quest")
    })

    it("returns verified for already-completed quest", async () => {
        // Complete connect-wallet in localStorage
        const state = { completed: [{ questId: "connect-wallet", completedAt: Date.now() }], totalXP: 10 }
        localStorage.setItem("memba_quests", JSON.stringify(state))

        const result = await verifyQuest("connect-wallet", "g1test", "http://rpc")
        expect(result.status).toBe("verified")
    })

    it("returns not_verified for quest with unmet prerequisite", async () => {
        // deploy-counter-pkg requires deploy-hello-pkg
        const result = await verifyQuest("deploy-counter-pkg", "g1test", "http://rpc")
        expect(result.status).toBe("not_verified")
        expect(result.message).toContain("Prerequisite")
    })

    it("returns not_verified for self_report quests", async () => {
        const result = await verifyQuest("write-10-tests", "g1test", "http://rpc")
        // write-10-tests requires deploy-hello-realm prerequisite first
        expect(result.status).toBe("not_verified")
    })

    it("connect-wallet returns verified when address provided", async () => {
        const result = await verifyQuest("connect-wallet", "g1testaddr", "http://rpc")
        expect(result.status).toBe("verified")
    })

    it("connect-wallet returns not_verified when no address", async () => {
        const result = await verifyQuest("connect-wallet", "", "http://rpc")
        expect(result.status).toBe("not_verified")
    })

    it("setup-profile returns not_verified without profile data", async () => {
        const result = await verifyQuest("setup-profile", "g1test", "http://rpc")
        // Backend call will fail in test env, should return not_verified or pending
        expect(["not_verified", "pending"]).toContain(result.status)
    })

    it("earn-500-xp returns not_verified with 0 XP", async () => {
        const result = await verifyQuest("earn-500-xp", "g1test", "http://rpc")
        expect(result.status).toBe("not_verified")
        expect(result.message).toContain("500")
    })

    it("visit-5-pages tracks progress correctly", async () => {
        // Set up 4 pages visited
        localStorage.setItem("memba_quest_pages_g1test", JSON.stringify(["a", "b", "c", "d"]))
        const result = await verifyQuest("visit-5-pages", "g1test", "http://rpc")
        expect(result.status).toBe("not_verified")
        expect(result.message).toContain("1 more")
    })

    it("visit-5-pages returns verified with 5 pages", async () => {
        localStorage.setItem("memba_quest_pages_g1test", JSON.stringify(["a", "b", "c", "d", "e"]))
        const result = await verifyQuest("visit-5-pages", "g1test", "http://rpc")
        expect(result.status).toBe("verified")
    })

    it("deployment quests ask for realm path", async () => {
        // deploy-hello-pkg has no prerequisite, verification type is on_chain
        const result = await verifyQuest("deploy-hello-pkg", "g1test", "http://rpc")
        expect(result.status).toBe("not_verified")
        expect(result.message).toContain("realm path")
    })
})

// ── Verification Result Types ───────────────────────────────

describe("verification result types", () => {
    it("verified result has correct shape", () => {
        const result: QuestVerificationResult = { status: "verified", message: "Quest requirements met" }
        expect(result.status).toBe("verified")
        expect(result.message).toBeTruthy()
    })

    it("pending result has correct shape", () => {
        const result: QuestVerificationResult = { status: "pending", message: "Checking..." }
        expect(result.status).toBe("pending")
    })

    it("not_verified result has correct shape", () => {
        const result: QuestVerificationResult = { status: "not_verified", message: "Need more XP" }
        expect(result.status).toBe("not_verified")
    })

    it("error result has correct shape", () => {
        const result: QuestVerificationResult = { status: "error", message: "Unknown quest" }
        expect(result.status).toBe("error")
    })
})
