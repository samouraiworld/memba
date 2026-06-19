import { describe, it, expect, beforeEach, vi } from "vitest"
import { create } from "@bufbuild/protobuf"
import { TokenSchema } from "../gen/memba/v1/memba_pb"

// Mock the backend client so syncQuestsToBackend / completeQuestVerified hit
// controllable stubs.
const syncQuestsMock = vi.fn()
const completeQuestMock = vi.fn()
vi.mock("./api", () => ({
    api: {
        syncQuests: (...args: unknown[]) => syncQuestsMock(...args),
        completeQuest: (...args: unknown[]) => completeQuestMock(...args),
    },
}))

import { syncQuestsToBackend, completeQuestVerified } from "./quests"

const STORAGE_KEY = "memba_quests"

describe("syncQuestsToBackend merge (P1-2)", () => {
    beforeEach(() => {
        localStorage.clear()
        syncQuestsMock.mockReset()
    })

    it("keeps a local completion the server did not record (no silent shrink)", async () => {
        // Local has two completions; the server only acknowledges one (e.g. the
        // on-chain register-username was rejected by a transient verify).
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            completed: [
                { questId: "connect-wallet", completedAt: 1000 },
                { questId: "register-username", completedAt: 2000 },
            ],
            totalXP: 30,
        }))
        syncQuestsMock.mockResolvedValue({
            state: {
                completed: [{ questId: "connect-wallet", completedAt: "2026-01-01T00:00:00Z" }],
                totalXp: 10,
            },
        })

        const result = await syncQuestsToBackend(create(TokenSchema, {}))

        expect(result.completed.map(c => c.questId).sort()).toEqual(["connect-wallet", "register-username"])
        // XP recomputed from the merged set: connect-wallet(10) + register-username(20)
        expect(result.totalXP).toBe(30)

        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
        expect(saved.completed.map((c: { questId: string }) => c.questId).sort())
            .toEqual(["connect-wallet", "register-username"])
    })

    it("adds server completions the client lacks (cross-device)", async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            completed: [{ questId: "connect-wallet", completedAt: 1000 }],
            totalXP: 10,
        }))
        syncQuestsMock.mockResolvedValue({
            state: {
                completed: [
                    { questId: "connect-wallet", completedAt: "2026-01-01T00:00:00Z" },
                    { questId: "use-cmdk", completedAt: "2026-01-02T00:00:00Z" },
                ],
                totalXp: 20,
            },
        })

        const result = await syncQuestsToBackend(create(TokenSchema, {}))
        expect(result.completed.map(c => c.questId).sort()).toEqual(["connect-wallet", "use-cmdk"])
        expect(result.totalXP).toBe(20) // connect-wallet(10) + use-cmdk(10)
    })
})

describe("completeQuestVerified (backend-gated)", () => {
    beforeEach(() => {
        localStorage.clear()
        completeQuestMock.mockReset()
    })

    it("records the completion locally only when the server grants it", async () => {
        completeQuestMock.mockResolvedValue({ state: { completed: [], totalXp: 0 } })

        const result = await completeQuestVerified("deploy-hello-pkg", "gno.land/r/alice/foo", create(TokenSchema, {}))

        expect(result.state.completed.some(c => c.questId === "deploy-hello-pkg")).toBe(true)
        expect(result.state.totalXP).toBe(20) // deploy-hello-pkg xp
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
        expect(saved.completed.map((c: { questId: string }) => c.questId)).toContain("deploy-hello-pkg")
    })

    it("throws and records nothing when the server rejects", async () => {
        completeQuestMock.mockRejectedValue(new Error("requirements not met"))

        await expect(
            completeQuestVerified("deploy-hello-pkg", "gno.land/r/alice/foo", create(TokenSchema, {})),
        ).rejects.toThrow()
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
})
