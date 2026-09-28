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

import { syncQuestsToBackend, completeQuestVerified, completeQuest, setQuestWalletAddress } from "./quests"

const STORAGE_KEY = "memba_quests"

describe("syncQuestsToBackend merge (P1-2)", () => {
    beforeEach(() => {
        localStorage.clear()
        setQuestWalletAddress(null)
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

    it("drops a retired local-only completion after sync but keeps server-recorded history", async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            completed: [{ questId: "connect-wallet", completedAt: 1000 }, { questId: "submit-feedback", completedAt: 2000 }],
            totalXP: 30,
        }))
        syncQuestsMock.mockResolvedValueOnce({ state: {
            completed: [{ questId: "connect-wallet", completedAt: "2026-01-01T00:00:00Z" }], totalXp: 10,
        } })
        const rejected = await syncQuestsToBackend(create(TokenSchema, {}))
        expect(syncQuestsMock.mock.calls[0][0].completions.map((c: { questId: string }) => c.questId)).toEqual(["connect-wallet"])
        expect(rejected.completed.map(c => c.questId)).toEqual(["connect-wallet"])
        expect(rejected.totalXP).toBe(10)

        syncQuestsMock.mockResolvedValueOnce({ state: {
            completed: [
                { questId: "connect-wallet", completedAt: "2026-01-01T00:00:00Z" },
                { questId: "submit-feedback", completedAt: "2026-01-02T00:00:00Z" },
            ], totalXp: 30,
        } })
        const historical = await syncQuestsToBackend(create(TokenSchema, {}))
        expect(historical.completed.map(c => c.questId).sort()).toEqual(["connect-wallet", "submit-feedback"])
        expect(historical.totalXP).toBe(30)
    })

    it("writes a late sync response only to the authenticated wallet", async () => {
        const alice = "g1alice"
        const bob = "g1bob"
        setQuestWalletAddress(alice)
        completeQuest("connect-wallet")
        let release: (value: unknown) => void = () => {}
        syncQuestsMock.mockImplementation(() => new Promise(resolve => { release = resolve }))
        const pending = syncQuestsToBackend(create(TokenSchema, { userAddress: alice }))
        setQuestWalletAddress(bob)
        completeQuest("use-cmdk")
        release({ state: { completed: [{ questId: "visit-5-pages", completedAt: "2026-01-01T00:00:00Z" }] } })
        await pending
        const a = JSON.parse(localStorage.getItem(`${STORAGE_KEY}_${alice}`)!)
        const b = JSON.parse(localStorage.getItem(`${STORAGE_KEY}_${bob}`)!)
        expect(a.completed.map((c: { questId: string }) => c.questId).sort()).toEqual(["connect-wallet", "visit-5-pages"])
        expect(b.completed.map((c: { questId: string }) => c.questId)).toEqual(["use-cmdk"])
    })

    it("retains a same-wallet completion earned while sync is pending", async () => {
        const alice = "g1alice"
        setQuestWalletAddress(alice)
        completeQuest("connect-wallet")
        let release: (value: unknown) => void = () => {}
        syncQuestsMock.mockImplementation(() => new Promise(resolve => { release = resolve }))
        const pending = syncQuestsToBackend(create(TokenSchema, { userAddress: alice }))
        completeQuest("use-cmdk")
        release({ state: { completed: [] } })
        const merged = await pending
        expect(merged.completed.map(c => c.questId).sort()).toEqual(["connect-wallet", "use-cmdk"])
    })
})

describe("completeQuestVerified (backend-gated)", () => {
    beforeEach(() => {
        localStorage.clear()
        setQuestWalletAddress(null)
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

    it("records a late verified completion only for the token's wallet", async () => {
        const alice = "g1alice"
        const bob = "g1bob"
        setQuestWalletAddress(alice)
        let release: (value: unknown) => void = () => {}
        completeQuestMock.mockImplementation(() => new Promise(resolve => { release = resolve }))
        const pending = completeQuestVerified("deploy-hello-pkg", "gno.land/r/alice/foo", create(TokenSchema, { userAddress: alice }))
        setQuestWalletAddress(bob)
        completeQuest("use-cmdk")
        release({ state: { completed: [] } })
        await pending
        expect(JSON.parse(localStorage.getItem(`${STORAGE_KEY}_${alice}`)!).completed.map((c: { questId: string }) => c.questId)).toContain("deploy-hello-pkg")
        expect(JSON.parse(localStorage.getItem(`${STORAGE_KEY}_${bob}`)!).completed.map((c: { questId: string }) => c.questId)).toEqual(["use-cmdk"])
    })
})
