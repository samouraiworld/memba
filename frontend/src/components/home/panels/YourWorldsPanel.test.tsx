/**
 * YourWorldsPanel.test.tsx
 *
 * Per-panel isolation contract:
 *   1. With saved DAOs → DashboardDAOList renders (DAO name visible)
 *   2. Empty saved DAOs → cold-start invitation links render (join/faucet/quest)
 *   3. Empty state is never a blank panel
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
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

// ── Mock DashboardDAOList so we don't hit real RPC calls ─────────────────
vi.mock("../../dashboard/DashboardDAOList", () => ({
    DashboardDAOList: vi.fn(({ savedDAOs }: { savedDAOs: { name: string }[] }) => (
        <div data-testid="dashboard-dao-list">
            {savedDAOs.map((d) => (
                <div key={d.name} data-testid="dao-list-item">
                    {d.name}
                </div>
            ))}
        </div>
    )),
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

    it("renders DashboardDAOList when DAOs exist", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByTestId("dashboard-dao-list")).toBeInTheDocument()
    })

    it("shows DAO names from savedDAOs", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByText("GovDAO")).toBeInTheDocument()
        expect(screen.getByText("MyOrg DAO")).toBeInTheDocument()
    })

    it("shows the panel title", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.getByText("Your worlds")).toBeInTheDocument()
    })

    it("does NOT show invitation links when DAOs exist", () => {
        renderWithProviders(<YourWorldsPanel />)
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

    it("does NOT render DashboardDAOList when empty", () => {
        renderWithProviders(<YourWorldsPanel />)
        expect(screen.queryByTestId("dashboard-dao-list")).not.toBeInTheDocument()
    })

    it("does NOT throw when empty", () => {
        expect(() => renderWithProviders(<YourWorldsPanel />)).not.toThrow()
    })
})
