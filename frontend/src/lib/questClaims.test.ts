/**
 * questClaims.test.ts — backend-authoritative claim status reads.
 *
 * fetchQuestClaimStatuses is the user-facing read for self-report claim
 * lifecycle (pending/approved/rejected) via GetUserQuests. The backend is the
 * source of truth; localStorage (hasSubmittedClaim) is only an optimistic hint,
 * so this function must return null (not an empty map) when the backend is
 * unreachable, letting callers fall back to the hint.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const getUserQuestsMock = vi.fn()
const submitQuestClaimMock = vi.fn()
vi.mock("./api", () => ({
    api: {
        getUserQuests: (...args: unknown[]) => getUserQuestsMock(...args),
        submitQuestClaim: (...args: unknown[]) => submitQuestClaimMock(...args),
    },
}))

import { fetchQuestClaimStatuses, hasSubmittedClaim, submitQuestClaim } from "./questClaims"
import { create } from "@bufbuild/protobuf"
import { TokenSchema } from "../gen/memba/v1/memba_pb"

describe("fetchQuestClaimStatuses", () => {
    beforeEach(() => {
        getUserQuestsMock.mockReset()
    })

    it("maps backend claim statuses by quest id", async () => {
        getUserQuestsMock.mockResolvedValue({
            state: { completed: [], totalXp: 0 },
            claimStatuses: [
                { questId: "fix-upstream-bug", status: "rejected", createdAt: "2026-07-01 10:00:00", reviewedAt: "2026-07-01 12:00:00" },
                { questId: "write-tutorial", status: "pending", createdAt: "2026-07-02 09:00:00", reviewedAt: "" },
            ],
        })

        const statuses = await fetchQuestClaimStatuses("g1alice")

        expect(statuses).not.toBeNull()
        expect(statuses!.get("fix-upstream-bug")?.status).toBe("rejected")
        expect(statuses!.get("fix-upstream-bug")?.reviewedAt).toBe("2026-07-01 12:00:00")
        expect(statuses!.get("write-tutorial")?.status).toBe("pending")
        expect(statuses!.has("unknown-quest")).toBe(false)
    })

    it("returns an empty map when the user has no claims (authoritative none)", async () => {
        getUserQuestsMock.mockResolvedValue({ state: { completed: [], totalXp: 0 }, claimStatuses: [] })

        const statuses = await fetchQuestClaimStatuses("g1alice")

        expect(statuses).not.toBeNull()
        expect(statuses!.size).toBe(0)
    })

    it("returns null when the backend is unreachable (caller falls back to local hint)", async () => {
        getUserQuestsMock.mockRejectedValue(new Error("network down"))

        expect(await fetchQuestClaimStatuses("g1alice")).toBeNull()
    })

    it("returns null for an empty address without calling the backend", async () => {
        expect(await fetchQuestClaimStatuses("")).toBeNull()
        expect(getUserQuestsMock).not.toHaveBeenCalled()
    })

    it("ignores rows with unknown status values", async () => {
        getUserQuestsMock.mockResolvedValue({
            state: { completed: [], totalXp: 0 },
            claimStatuses: [
                { questId: "fix-upstream-bug", status: "weird", createdAt: "", reviewedAt: "" },
                { questId: "write-tutorial", status: "approved", createdAt: "", reviewedAt: "" },
            ],
        })

        const statuses = await fetchQuestClaimStatuses("g1alice")
        expect(statuses!.has("fix-upstream-bug")).toBe(false)
        expect(statuses!.get("write-tutorial")?.status).toBe("approved")
    })
})

describe("submitQuestClaim local hint", () => {
    beforeEach(() => {
        localStorage.clear()
        submitQuestClaimMock.mockReset()
    })

    it("records the optimistic hint after a successful submit", async () => {
        submitQuestClaimMock.mockResolvedValue({ status: "pending" })

        await submitQuestClaim(create(TokenSchema, {}), "g1alice", "fix-upstream-bug", "https://x", "")

        expect(hasSubmittedClaim("g1alice", "fix-upstream-bug")).toBe(true)
    })

    it("does not record the hint when the submit fails", async () => {
        submitQuestClaimMock.mockRejectedValue(new Error("boom"))

        await expect(
            submitQuestClaim(create(TokenSchema, {}), "g1alice", "fix-upstream-bug", "https://x", ""),
        ).rejects.toThrow()
        expect(hasSubmittedClaim("g1alice", "fix-upstream-bug")).toBe(false)
    })
})
