/**
 * Treasury Kill-Switch Tests — A1.a (AAA-0 CRITICAL)
 *
 * Validates that the TREASURY_SPEND_ENABLED feature flag correctly gates:
 * 1. The "Propose Spend" button on the Treasury page
 * 2. Deposit-inviting empty-state copy (replaced with fund-safety warning)
 * 3. The TreasuryProposal page (route-level deep-link gating)
 * 4. The misleading "execute… to complete the transfer" copy is removed
 *
 * @see docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md §5/A1.a
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import type { LayoutContext } from "../types/layout"

// ── Mocks ─────────────────────────────────────────────────────

vi.mock("../lib/config", async () => {
    const actual = await vi.importActual("../lib/config") as Record<string, unknown>
    return {
        ...actual,
        GNO_RPC_URL: "https://rpc.test.local",
        GNO_CHAIN_ID: "test12",
        GNO_FALLBACK_RPC_URLS: [],
        GNO_FAUCET_URL: "",
        APP_VERSION: "test",
        TREASURY_SPEND_ENABLED: false,
        getExplorerBaseUrl: () => "https://test12.gno.land",
    }
})

vi.mock("../lib/dao", () => ({
    getDAOConfig: vi.fn().mockResolvedValue({ name: "Test DAO", description: "A test DAO" }),
    getDAOMembers: vi.fn().mockResolvedValue([
        { address: "g1testaddr1234567890abcdefghijklmnop", power: 1, roles: ["admin"] },
    ]),
    buildProposeMsg: vi.fn(),
}))

vi.mock("../lib/grc20", () => ({
    getTokenBalance: vi.fn().mockResolvedValue(0n),
    listFactoryTokens: vi.fn().mockResolvedValue([]),
    doContractBroadcast: vi.fn(),
}))

vi.mock("../lib/rpcFallback", () => ({
    resilientFetch: vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ result: { response: { ResponseBase: {} } } }),
    }),
}))

vi.mock("../hooks/useDaoRoute", () => ({
    useDaoRoute: () => ({
        realmPath: "gno.land/r/test/dao",
        encodedSlug: "gno.land%2Fr%2Ftest%2Fdao",
    }),
}))

vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkNav: () => vi.fn(),
    useNetworkKey: () => "test12",
}))

// ── Helpers ───────────────────────────────────────────────────

const mockLayoutContext: LayoutContext = {
    auth: { isAuthenticated: true, token: "test-token", address: "g1testaddr1234567890abcdefghijklmnop" },
    adena: {
        address: "g1testaddr1234567890abcdefghijklmnop",
        connected: true,
        connecting: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        signArbitrary: vi.fn(),
    },
} as unknown as LayoutContext

function LayoutWrapper() {
    return <Outlet context={mockLayoutContext} />
}

function renderInRoute(element: React.ReactElement, path = "/test12/dao/gno.land/r/test/dao/treasury") {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route element={<LayoutWrapper />}>
                    <Route path="/:network/dao/*" element={element} />
                </Route>
            </Routes>
        </MemoryRouter>,
    )
}

// ── Tests ─────────────────────────────────────────────────────

describe("Treasury kill-switch (A1.a)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe("Treasury page — when TREASURY_SPEND_ENABLED is false (default)", () => {
        it("should NOT render the 'Propose Spend' button", async () => {
            const { Treasury } = await import("./Treasury")
            renderInRoute(<Treasury />)

            // Wait for the page to load (loading state resolves)
            await waitFor(() => {
                expect(screen.getByText("💰 Treasury")).toBeDefined()
            }, { timeout: 3000 })

            // The "Propose Spend" button must not exist
            expect(screen.queryByText("+ Propose Spend")).toBeNull()
        })

        it("should NOT show deposit-inviting empty-state copy", async () => {
            const { Treasury } = await import("./Treasury")
            renderInRoute(<Treasury />)

            await waitFor(() => {
                expect(screen.getByText("💰 Treasury")).toBeDefined()
            }, { timeout: 3000 })

            // The old inviting copy must be gone
            expect(screen.queryByText(/will appear once tokens are transferred/i)).toBeNull()
        })

        it("should show a fund-safety warning banner", async () => {
            const { Treasury } = await import("./Treasury")
            renderInRoute(<Treasury />)

            await waitFor(() => {
                expect(screen.getByText("💰 Treasury")).toBeDefined()
            }, { timeout: 3000 })

            // Must show the warning about treasury spending not being enforced
            expect(screen.getByText(/not yet enforced on-chain/i)).toBeDefined()
        })
    })

    describe("TreasuryProposal page — route-level deep-link gating", () => {
        it("should render a warning instead of the proposal form when flag is off", async () => {
            const { TreasuryProposal } = await import("./TreasuryProposal")
            renderInRoute(
                <TreasuryProposal />,
                "/test12/dao/gno.land/r/test/dao/treasury/propose",
            )

            // The proposal form should NOT render
            expect(screen.queryByText("Submit Treasury Proposal")).toBeNull()

            // The heading should indicate spending is unavailable
            expect(screen.getByText("Treasury Spending Unavailable")).toBeDefined()
        })

        it("should show the fund-safety warning on the gated page", async () => {
            const { TreasuryProposal } = await import("./TreasuryProposal")
            renderInRoute(
                <TreasuryProposal />,
                "/test12/dao/gno.land/r/test/dao/treasury/propose",
            )

            expect(screen.getByText(/not yet enforced on-chain/i)).toBeDefined()
            expect(screen.getByText(/cannot be recovered/i)).toBeDefined()
        })

        it("should NOT show the misleading 'execute to complete the transfer' copy", async () => {
            const { TreasuryProposal } = await import("./TreasuryProposal")
            renderInRoute(
                <TreasuryProposal />,
                "/test12/dao/gno.land/r/test/dao/treasury/propose",
            )

            // The misleading info banner copy must not exist in any state
            expect(screen.queryByText(/execute the proposal to complete the transfer/i)).toBeNull()
        })
    })
})

describe("Treasury — partial-failure honesty (P1-7)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("surfaces a notice when a balance source fails instead of silently showing an incomplete treasury", async () => {
        const grc20 = await import("../lib/grc20")
        vi.mocked(grc20.listFactoryTokens).mockRejectedValueOnce(new Error("RPC down"))

        const { Treasury } = await import("./Treasury")
        renderInRoute(<Treasury />)

        await waitFor(() => expect(screen.getByText("💰 Treasury")).toBeDefined(), { timeout: 3000 })
        // The treasury must NOT pretend the (now-incomplete) asset list is complete.
        expect(screen.getByText(/treasury shown may be incomplete/i)).toBeDefined()
    })
})
