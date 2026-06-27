/**
 * useMemberStanding.test.ts — TDD spec for the member-hero standing hook.
 *
 * Surfaces the connected member's XP / rank / candidature progress. Backend XP is
 * authoritative when reachable (closes the localStorage-XP bypass); falls back to
 * the local quest progress when the backend is unreachable or the wallet is
 * disconnected. Rank + thresholds come from the real gnobuilders tier system, so
 * 0 XP is an honest "Newcomer" starting rung (never a fabricated value).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

// Partial-mock: stub the data sources, keep the real isEligibleForCandidature so
// the eligibility math is exercised against the real Gold threshold.
vi.mock("../../lib/quests", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/quests")>()
    return {
        ...actual,
        fetchUserQuests: vi.fn(),
        loadQuestProgress: vi.fn(() => ({ completed: [], totalXP: 0 })),
        isLegacyEligible: vi.fn(() => false),
    }
})

const quests = await import("../../lib/quests")

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

beforeEach(() => { vi.clearAllMocks() })

describe("useMemberStanding", () => {
    it("uses backend XP as authoritative over local when both are present", async () => {
        vi.mocked(quests.loadQuestProgress).mockReturnValue({ completed: [], totalXP: 50 })
        vi.mocked(quests.fetchUserQuests).mockResolvedValue({ completed: [], totalXP: 200 })
        const { useMemberStanding } = await import("./useMemberStanding")
        const { result } = renderHook(() => useMemberStanding("g1abc", true), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.totalXP).toBe(200))
        // 200 XP → Silver Builder (150), candidature (Gold) at 350.
        expect(result.current.rank.name).toBe("Silver Builder")
        expect(result.current.candidatureThreshold).toBe(350)
        expect(result.current.xpToCandidature).toBe(150)
        expect(result.current.isEligible).toBe(false)
    })

    it("falls back to local XP when the backend is unreachable (degrade, not block)", async () => {
        vi.mocked(quests.loadQuestProgress).mockReturnValue({ completed: [], totalXP: 400 })
        vi.mocked(quests.fetchUserQuests).mockResolvedValue(null)
        const { useMemberStanding } = await import("./useMemberStanding")
        const { result } = renderHook(() => useMemberStanding("g1abc", true), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.totalXP).toBe(400))
        // 400 ≥ 350 → eligible, Gold Architect, xpToCandidature clamps to 0.
        expect(result.current.rank.name).toBe("Gold Architect")
        expect(result.current.isEligible).toBe(true)
        expect(result.current.xpToCandidature).toBe(0)
        expect(result.current.candidatureProgress).toBe(1)
    })

    it("is honest about a brand-new member (0 XP → Newcomer rung, not an empty/error)", async () => {
        vi.mocked(quests.loadQuestProgress).mockReturnValue({ completed: [], totalXP: 0 })
        vi.mocked(quests.fetchUserQuests).mockResolvedValue({ completed: [], totalXP: 0 })
        const { useMemberStanding } = await import("./useMemberStanding")
        const { result } = renderHook(() => useMemberStanding("g1abc", true), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.totalXP).toBe(0)
        expect(result.current.rank.name).toBe("Newcomer")
        expect(result.current.xpToCandidature).toBe(350)
        expect(result.current.candidatureProgress).toBe(0)
        expect(result.current.isEligible).toBe(false)
        expect(result.current.nextRank?.name).toBe("Bronze Explorer")
    })

    it("does not leak local XP into an unauthenticated render (honest 0 baseline)", async () => {
        // react-query still evaluates placeholderData for a disabled query, so a
        // disconnected member must NOT surface leftover localStorage XP.
        vi.mocked(quests.loadQuestProgress).mockReturnValue({ completed: [], totalXP: 999 })
        const { useMemberStanding } = await import("./useMemberStanding")
        const { result } = renderHook(() => useMemberStanding("g1abc", false), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.totalXP).toBe(0)
        expect(result.current.rank.name).toBe("Newcomer")
        expect(quests.fetchUserQuests).not.toHaveBeenCalled()
    })

    it("returns the honest 0 baseline when there is no address", async () => {
        vi.mocked(quests.loadQuestProgress).mockReturnValue({ completed: [], totalXP: 500 })
        const { useMemberStanding } = await import("./useMemberStanding")
        const { result } = renderHook(() => useMemberStanding(null, true), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.totalXP).toBe(0)
    })

    it("exposes xpToNext toward the next rank", async () => {
        vi.mocked(quests.loadQuestProgress).mockReturnValue({ completed: [], totalXP: 60 })
        vi.mocked(quests.fetchUserQuests).mockResolvedValue({ completed: [], totalXP: 60 })
        const { useMemberStanding } = await import("./useMemberStanding")
        const { result } = renderHook(() => useMemberStanding("g1abc", true), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.totalXP).toBe(60))
        // 60 XP → Bronze Explorer (50); next is Silver Builder (150) → 90 to go.
        expect(result.current.rank.name).toBe("Bronze Explorer")
        expect(result.current.nextRank?.name).toBe("Silver Builder")
        expect(result.current.xpToNext).toBe(90)
    })
})
