/**
 * YourWorldsPanel.test.tsx
 *
 * Per-panel isolation contract:
 *   1. With saved DAOs → Door cards board renders (world names visible)
 *   2. Empty saved DAOs → cold-start invitation links render (join/faucet/quest)
 *   3. Empty state is never a blank panel
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders, mockLayoutContext } from "../../../test/test-utils"
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

// ── Mock useOutletContext (LayoutContext) ─────────────────────────────────
vi.mock("react-router-dom", async () => {
    const actual = await import("react-router-dom")
    return {
        ...actual,
        useOutletContext: vi.fn(() =>
            mockLayoutContext({
                auth: {
                    token: null,
                    isAuthenticated: true,
                    address: "g1testaddress",
                    loading: false,
                    error: null,
                },
            }),
        ),
    }
})

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

// ── Resolve mocks for per-test control ────────────────────────────────────
const daoSlugMod = await import("../../../lib/daoSlug")

describe("YourWorldsPanel — with saved DAOs", () => {
    beforeEach(() => {
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

    it("shows DAO names from savedDAOs as Door cards", async () => {
        renderWithProviders(<YourWorldsPanel />)
        await waitFor(() => {
            // GovDAO appears as both the door eyebrow and body text — getAllByText handles multiple matches
            const items = screen.getAllByText("GovDAO")
            expect(items.length).toBeGreaterThan(0)
        })
    })

    it("shows the panel title", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByText("Your worlds")).toBeInTheDocument()
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
