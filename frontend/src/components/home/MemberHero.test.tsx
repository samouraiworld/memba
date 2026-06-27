/**
 * MemberHero.test.tsx — the connected member's above-the-fold anchor (W-M1).
 *
 * Covers: identity (avatar initials + @username/address), honest wallet balance
 * (omitted unless rawUgnot > 0n), and the standing card — XP + rank + a candidature
 * progress bar that switches between "Earn XP" (below threshold) and "Apply to
 * Memba DAO" (eligible).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import { RANK_TIERS } from "../../lib/gnobuilders"
import type { MemberStanding } from "../../hooks/home/useMemberStanding"

const newcomer = RANK_TIERS[0]
const silver = RANK_TIERS[2]
const gold = RANK_TIERS[3]

// ── Mocked outlet context (wallet identity source) ────────────────────────────
const mockOutletContext = vi.fn()
vi.mock("react-router-dom", async () => {
    const actual = await import("react-router-dom")
    return { ...actual, useOutletContext: () => mockOutletContext() }
})

vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: () => "test13",
}))

const mockIdentity = vi.fn()
const mockStanding = vi.fn()
vi.mock("../../hooks/home/useMemberIdentity", () => ({
    useMemberIdentity: () => mockIdentity(),
}))
vi.mock("../../hooks/home/useMemberStanding", () => ({
    useMemberStanding: () => mockStanding(),
}))

const ctx = (balance: string, rawUgnot: bigint) => ({
    adena: { connected: true, address: "g1q9abc123def456xyz7", installed: true, loading: false, connect: vi.fn(), disconnect: vi.fn(), signArbitrary: vi.fn(), pubkeyJSON: "", chainId: "test13" },
    balance,
    rawUgnot,
    auth: { token: null, isAuthenticated: true, address: "g1q9abc123def456xyz7", loading: false, error: null },
    isLoggingIn: false,
    syncTimedOut: false,
})

const standing = (over: Partial<MemberStanding> = {}): MemberStanding => ({
    loading: false,
    totalXP: 60,
    rank: silver,
    nextRank: gold,
    xpToNext: 90,
    candidatureThreshold: 350,
    xpToCandidature: 290,
    candidatureProgress: 60 / 350,
    isEligible: false,
    ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
    mockOutletContext.mockReturnValue(ctx("12 GNOT", 12_000_000n))
    mockIdentity.mockReturnValue({ loading: false, username: "alice", displayName: "@alice", initials: "AL" })
    mockStanding.mockReturnValue(standing())
})

async function renderHero() {
    const { MemberHero } = await import("./MemberHero")
    renderWithProviders(<MemberHero />, { route: "/test13/" })
}

describe("MemberHero — identity", () => {
    it("shows the @username display name and avatar initials", async () => {
        await renderHero()
        expect(screen.getByTestId("member-hero-name")).toHaveTextContent("@alice")
        expect(screen.getByText("AL")).toBeInTheDocument()
    })

    it("shows the honest wallet balance chip when the balance is positive", async () => {
        await renderHero()
        expect(screen.getByTestId("wallet-chip-balance")).toHaveTextContent("12 GNOT")
    })

    it("omits the balance chip for an empty account (0 GNOT / rawUgnot 0n)", async () => {
        mockOutletContext.mockReturnValue(ctx("0 GNOT", 0n))
        await renderHero()
        expect(screen.queryByTestId("wallet-chip-balance")).not.toBeInTheDocument()
    })
})

describe("MemberHero — standing", () => {
    it("shows XP, rank, and a progress bar toward candidature", async () => {
        await renderHero()
        expect(screen.getByTestId("member-standing-xp")).toHaveTextContent("60")
        expect(screen.getByText("silver builder")).toBeInTheDocument()
        const bar = screen.getByRole("progressbar")
        expect(bar).toHaveAttribute("aria-valuenow", String(Math.round((60 / 350) * 100)))
    })

    it("offers 'Earn XP' with the XP-to-candidature hint when below threshold", async () => {
        await renderHero()
        expect(screen.getByText(/290 XP to Memba DAO candidature/)).toBeInTheDocument()
        expect(screen.getByTestId("member-standing-quests")).toHaveAttribute("href", "/test13/quests")
        expect(screen.queryByTestId("member-standing-apply")).not.toBeInTheDocument()
    })

    it("offers 'Apply to Memba DAO' when eligible (Gold reached)", async () => {
        mockStanding.mockReturnValue(standing({ totalXP: 380, rank: gold, nextRank: RANK_TIERS[4], xpToCandidature: 0, candidatureProgress: 1, isEligible: true }))
        await renderHero()
        const apply = screen.getByTestId("member-standing-apply")
        expect(apply).toHaveAttribute("href", "/test13/candidature")
        expect(screen.queryByTestId("member-standing-quests")).not.toBeInTheDocument()
    })

    it("frames a brand-new member honestly (0 XP → Newcomer rung, not a blank/error)", async () => {
        mockStanding.mockReturnValue(standing({ totalXP: 0, rank: newcomer, nextRank: RANK_TIERS[1], xpToNext: 50, xpToCandidature: 350, candidatureProgress: 0 }))
        await renderHero()
        expect(screen.getByTestId("member-standing-xp")).toHaveTextContent("0")
        expect(screen.getByText("newcomer")).toBeInTheDocument()
        expect(screen.getByText(/350 XP to Memba DAO candidature/)).toBeInTheDocument()
    })
})
