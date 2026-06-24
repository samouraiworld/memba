/**
 * YourWorldsPanel.test.tsx
 *
 * Per-panel isolation contract:
 *   1. With saved DAOs → Door cards board renders (world names visible, once)
 *   2. Empty saved DAOs → cold-start invitation links render (join/faucet/quest)
 *   3. Empty state is never a blank panel
 *   4. Error state → error Door with retry control renders
 *   5. Error state → onRetry button calls refetch from the hook
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { YourWorldsPanel } from "./YourWorldsPanel"

// ── Mock getSavedDAOsForOrg ───────────────────────────────────────────────
vi.mock("../../../lib/daoSlug", () => ({
    getSavedDAOsForOrg: vi.fn(() => []),
}))

// ── Mock useOrg ───────────────────────────────────────────────────────────
vi.mock("../../../contexts/OrgContext", () => ({
    useOrg: vi.fn(() => ({
        activeOrgId: null,
        activeOrgName: "Personal",
        isOrgMode: false,
        setActiveOrg: vi.fn(),
    })),
}))

// ── Mock getDAOConfig + getDAOProposals (TanStack Query data source) ───────
vi.mock("../../../lib/dao", () => ({
    getDAOConfig: vi.fn().mockResolvedValue({
        name: "GovDAO",
        description: "",
        threshold: "60%",
        memberCount: 3,
        memberstorePath: "",
        tierDistribution: [],
        isArchived: false,
    }),
    getDAOProposals: vi.fn().mockResolvedValue([
        {
            id: 1,
            title: "Test Proposal",
            description: "",
            category: "governance",
            status: "open",
            author: "@user",
            authorProfile: "",
            tiers: [],
            yesPercent: 0,
            noPercent: 0,
            yesVotes: 0,
            noVotes: 0,
            abstainVotes: 0,
            totalVoters: 0,
            proposer: "@user",
        },
    ]),
}))

// ── Mock useYourWorlds for error-state tests ──────────────────────────────
vi.mock("../../../hooks/home/useYourWorlds", async () => {
    const actual = await import("../../../hooks/home/useYourWorlds")
    return {
        ...actual,
        useYourWorlds: vi.fn(() => ({ state: "empty" as const, worlds: [], refetch: vi.fn() })),
    }
})

// ── Resolve mocks for per-test control ────────────────────────────────────
const daoSlugMod = await import("../../../lib/daoSlug")
const yourWorldsMod = await import("../../../hooks/home/useYourWorlds")

describe("YourWorldsPanel — with saved DAOs", () => {
    beforeEach(() => {
        // Restore real hook behaviour: delegate to the real implementation via
        // the saved DAO mock (the hook itself reads getSavedDAOsForOrg).
        vi.mocked(yourWorldsMod.useYourWorlds).mockImplementation(
            (networkKey, orgId) => {
                // Call through to the actual (un-mocked) implementation.
                // We can't import the actual here easily, so we reconstruct
                // the expected output from what the sub-mocks return.
                const savedDAOs = daoSlugMod.getSavedDAOsForOrg(orgId)
                if (savedDAOs.length === 0) return { state: "empty" as const, worlds: [], refetch: vi.fn() }
                return {
                    state: "ready" as const,
                    worlds: savedDAOs.map((dao) => ({
                        name: dao.name,
                        href: `/${networkKey}/dao/${dao.realmPath}`,
                    })),
                    refetch: vi.fn(),
                }
            },
        )
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([
            { realmPath: "gno.land/r/gov/dao", name: "GovDAO", addedAt: 1000 },
            { realmPath: "gno.land/r/test/myorg", name: "MyOrg DAO", addedAt: 2000 },
        ])
    })

    it("renders the panel container", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByTestId("your-worlds-panel")).toBeInTheDocument()
    })

    it("renders the worlds board when DAOs exist", async () => {
        renderWithProviders(<YourWorldsPanel />)
        await waitFor(() =>
            expect(screen.getByTestId("your-worlds-board")).toBeInTheDocument(),
        )
    })

    it("shows each DAO name exactly once as a Door card body", async () => {
        renderWithProviders(<YourWorldsPanel />)
        await waitFor(() => {
            // After fix #1, "GovDAO" is only in the body span — never in the eyebrow.
            expect(screen.getByText("GovDAO")).toBeInTheDocument()
        })
    })

    it("shows the panel title", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByText("Your organisations")).toBeInTheDocument()
    })

    it("does NOT show invitation section when DAOs exist", async () => {
        renderWithProviders(<YourWorldsPanel />)
        await waitFor(() =>
            expect(screen.getByTestId("your-worlds-board")).toBeInTheDocument(),
        )
        expect(screen.queryByTestId("your-worlds-invite")).not.toBeInTheDocument()
    })
})

describe("YourWorldsPanel — empty state (no saved DAOs)", () => {
    beforeEach(() => {
        vi.mocked(yourWorldsMod.useYourWorlds).mockReturnValue({
            state: "empty" as const,
            worlds: [],
            refetch: vi.fn(),
        })
        vi.mocked(daoSlugMod.getSavedDAOsForOrg).mockReturnValue([])
    })

    it("renders the panel container (never blank)", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByTestId("your-worlds-panel")).toBeInTheDocument()
    })

    it("shows the invitation section", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByTestId("your-worlds-invite")).toBeInTheDocument()
    })

    it("shows a join-DAO invitation link", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByTestId("invite-join-dao")).toBeInTheDocument()
    })

    it("shows a faucet invitation link", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByTestId("invite-faucet")).toBeInTheDocument()
    })

    it("shows a quests invitation link", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByTestId("invite-quests")).toBeInTheDocument()
    })

    it("does NOT render the worlds board when empty", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.queryByTestId("your-worlds-board")).not.toBeInTheDocument()
    })

    it("does NOT throw when empty", () => {
        expect(() => renderWithProviders(<YourWorldsPanel />)).not.toThrow()
    })
})

describe("YourWorldsPanel — error state", () => {
    beforeEach(() => {
        vi.mocked(yourWorldsMod.useYourWorlds).mockReturnValue({
            state: "error" as const,
            worlds: [],
            refetch: vi.fn(),
        })
    })

    it("renders the panel container", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByTestId("your-worlds-panel")).toBeInTheDocument()
    })

    it("renders a retry control when state is error", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
    })

    it("does NOT render the worlds board on error", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.queryByTestId("your-worlds-board")).not.toBeInTheDocument()
    })

    it("clicking retry calls refetch from the hook", () => {
        const mockRefetch = vi.fn()
        vi.mocked(yourWorldsMod.useYourWorlds).mockReturnValue({
            state: "error" as const,
            worlds: [],
            refetch: mockRefetch,
        })

        renderWithProviders(<YourWorldsPanel />)
        fireEvent.click(screen.getByRole("button", { name: /retry/i }))
        expect(mockRefetch).toHaveBeenCalledTimes(1)
    })
})
