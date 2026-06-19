/**
 * FeaturedDaoPanel.test.tsx
 *
 * Covers:
 * 1. With data — renders DAO name, open-proposal headline, verify-on-chain link
 * 2. Featured realm invalid on network — panel self-hides (renders null)
 * 3. No featured realm (null) — panel self-hides
 * 4. Loading state — shows skeleton cards
 * 5. No open proposals — renders "—" for proposal count without crashing
 * 6. Snapshot usable with populated featuredDao → renders snapshot data, no on-chain calls
 * 7. Snapshot usable but featuredDao empty/realmPath blank → panel self-hides
 * 8. Snapshot NOT usable → on-chain path fires (existing tests cover this)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import { FeaturedDaoPanel } from "./FeaturedDaoPanel"

// ── Module-level mocks ────────────────────────────────────────

vi.mock("../../../hooks/useNetwork", () => ({
    useNetwork: vi.fn(() => ({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
        chainId: "test-13",
        label: "Testnet 13",
        switchNetwork: vi.fn(),
        networks: {},
    })),
}))

// Mock config — getFeaturedDaoRealm and getExplorerBaseUrl are the critical
// surface points for this panel.
vi.mock("../../../lib/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../lib/config")>()
    return {
        ...actual,
        getFeaturedDaoRealm: vi.fn(() => "gno.land/r/samcrew/memba_dao"),
        getExplorerBaseUrl: vi.fn(() => "https://test13.testnets.gno.land"),
    }
})

// Mock the DAO read helpers — no real RPC calls
vi.mock("../../../lib/dao", () => ({
    getDAOConfig: vi.fn(),
    getDAOProposals: vi.fn(),
}))

// Mock useHomeSnapshot — default: not usable, so existing on-chain tests are unaffected
vi.mock("../../../hooks/home/useHomeSnapshot", () => ({
    useHomeSnapshot: vi.fn(() => ({
        snapshot: null,
        usable: false,
        isLoading: false,
    })),
}))

// ── Resolve mocked modules for per-test control ───────────────

const networkMod = await import("../../../hooks/useNetwork")
const configMod = await import("../../../lib/config")
const daoMod = await import("../../../lib/dao")
const snapshotMod = await import("../../../hooks/home/useHomeSnapshot")

// ── Shared fixtures ───────────────────────────────────────────

const MOCK_CONFIG = {
    name: "Memba DAO",
    description: "The Memba governance DAO",
    threshold: "60%",
    memberCount: 12,
    memberstorePath: "",
    tierDistribution: [],
    isArchived: false,
}

const MOCK_PROPOSALS = [
    {
        id: 42,
        title: "Expand contributor rewards program",
        description: "",
        category: "governance",
        status: "open" as const,
        author: "@samourai",
        authorProfile: "",
        tiers: ["T1", "T2"],
        yesPercent: 0,
        noPercent: 0,
        yesVotes: 0,
        noVotes: 0,
        abstainVotes: 0,
        totalVoters: 0,
        proposer: "@samourai",
    },
]

function setupHappy() {
    vi.mocked(networkMod.useNetwork).mockReturnValue({
        networkKey: "test13",
        rpcUrl: "https://rpc.test13.gno.land",
        chainId: "test-13",
        label: "Testnet 13",
        switchNetwork: vi.fn(),
        networks: {},
    })
    vi.mocked(configMod.getFeaturedDaoRealm).mockReturnValue("gno.land/r/samcrew/memba_dao")
    vi.mocked(configMod.getExplorerBaseUrl).mockReturnValue("https://test13.testnets.gno.land")
    vi.mocked(daoMod.getDAOConfig).mockResolvedValue(MOCK_CONFIG)
    vi.mocked(daoMod.getDAOProposals).mockResolvedValue(MOCK_PROPOSALS)
}

// ── Tests ─────────────────────────────────────────────────────

describe("FeaturedDaoPanel — self-hides when realm absent", () => {
    beforeEach(() => {
        setupHappy()
    })

    it("renders null when getFeaturedDaoRealm returns null", () => {
        vi.mocked(configMod.getFeaturedDaoRealm).mockReturnValue(null)
        const { container } = renderWithProviders(<FeaturedDaoPanel />)
        expect(container.firstChild).toBeNull()
    })

    it("does NOT render the panel testid when realm is null", () => {
        vi.mocked(configMod.getFeaturedDaoRealm).mockReturnValue(null)
        renderWithProviders(<FeaturedDaoPanel />)
        expect(screen.queryByTestId("featured-dao-panel")).not.toBeInTheDocument()
    })

    it("renders null when network is test12 (realm not configured)", () => {
        vi.mocked(networkMod.useNetwork).mockReturnValue({
            networkKey: "test12",
            rpcUrl: "https://rpc.testnet12.samourai.live",
            chainId: "test12",
            label: "Testnet 12",
            switchNetwork: vi.fn(),
            networks: {},
        })
        // Simulate getFeaturedDaoRealm returning null for test12
        vi.mocked(configMod.getFeaturedDaoRealm).mockReturnValue(null)
        const { container } = renderWithProviders(<FeaturedDaoPanel />)
        expect(container.firstChild).toBeNull()
    })
})

describe("FeaturedDaoPanel — with data", () => {
    beforeEach(() => {
        setupHappy()
    })

    it("renders the panel container testid", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.getByTestId("featured-dao-panel")).toBeInTheDocument()
        })
    })

    it("renders the DAO name", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.getByText("Memba DAO")).toBeInTheDocument()
        })
    })

    it("renders the open-proposal headline title", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.getByText("Expand contributor rewards program")).toBeInTheDocument()
        })
    })

    it("renders a verify-on-chain link pointing to the gnoweb URL", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            const links = screen.getAllByRole("link")
            const hrefs = links.map(l => l.getAttribute("href"))
            // gnoweb URL: https://test13.testnets.gno.land/r/samcrew/memba_dao
            expect(hrefs).toContain("https://test13.testnets.gno.land/r/samcrew/memba_dao")
        })
    })

    it("renders a 'read it without connecting' link for the open proposal", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            const link = screen.getByText("read it without connecting ->")
            expect(link).toBeInTheDocument()
        })
    })

    it("in-app proposal link uses raw realm path with literal slashes (not %2F-encoded)", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            const links = screen.getAllByRole("link")
            const hrefs = links.map(l => l.getAttribute("href") ?? "")
            // Must contain a link with raw slashes: /test13/dao/gno.land/r/samcrew/memba_dao/proposal/42
            expect(hrefs.some(h => h.includes("/dao/gno.land/r/samcrew/memba_dao/proposal/42"))).toBe(true)
            // Must NOT contain %2F-encoded version (would 404 on the splat route)
            expect(hrefs.some(h => h.includes("%2F"))).toBe(false)
        })
    })

    it("renders the member count", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.getByText("12")).toBeInTheDocument()
        })
    })
})

describe("FeaturedDaoPanel — no open proposals", () => {
    beforeEach(() => {
        setupHappy()
        // Override proposals to all-closed
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([
            { ...MOCK_PROPOSALS[0], status: "accepted" as const },
        ])
    })

    it("shows '—' for open proposals count without crashing", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            const dashes = screen.getAllByText("—")
            // open count = 0 → "—"; no proposal meta shown
            expect(dashes.length).toBeGreaterThanOrEqual(1)
        })
    })

    it("does NOT render a proposal link when there are no open proposals", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.queryByText("read it without connecting ->")).not.toBeInTheDocument()
        })
    })
})

describe("FeaturedDaoPanel — loading state", () => {
    beforeEach(() => {
        setupHappy()
        // Make the DAO config query hang so loading stays true
        vi.mocked(daoMod.getDAOConfig).mockReturnValue(new Promise(() => { /* never resolves */ }))
    })

    it("shows skeleton cards while loading", () => {
        renderWithProviders(<FeaturedDaoPanel />)
        const skeletons = screen.getAllByTestId("action-card-skeleton")
        expect(skeletons.length).toBeGreaterThanOrEqual(1)
    })

    it("does not throw during loading", () => {
        expect(() => renderWithProviders(<FeaturedDaoPanel />)).not.toThrow()
    })
})

describe("FeaturedDaoPanel — config error / null config", () => {
    beforeEach(() => {
        setupHappy()
        // Simulate getDAOConfig returning null (realm not found)
        vi.mocked(daoMod.getDAOConfig).mockResolvedValue(null)
        vi.mocked(daoMod.getDAOProposals).mockResolvedValue([])
    })

    it("self-hides when config returns null", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.queryByTestId("featured-dao-panel")).not.toBeInTheDocument()
        })
    })
})

describe("FeaturedDaoPanel — snapshot path (usable snapshot)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setupHappy()
        // Provide a usable snapshot with a populated featuredDao
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: {
                featuredDao: {
                    realmPath: "gno.land/r/samcrew/memba_dao",
                    name: "Snapshot DAO",
                    members: 7,
                    treasuryUgnot: BigInt(0),
                    openProposals: 3,
                    latestProposalTitle: "Snapshot proposal title",
                },
            } as Parameters<typeof snapshotMod.useHomeSnapshot>[never],
            usable: true,
            isLoading: false,
        })
    })

    afterEach(() => {
        // Reset to non-usable default after snapshot tests
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
    })

    it("renders snapshot DAO name without calling getDAOConfig or getDAOProposals", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.getByText("Snapshot DAO")).toBeInTheDocument()
        })
        expect(daoMod.getDAOConfig).not.toHaveBeenCalled()
        expect(daoMod.getDAOProposals).not.toHaveBeenCalled()
    })

    it("renders the open-proposals count from snapshot", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.getByText("3")).toBeInTheDocument()
        })
    })

    it("renders the latest proposal title from snapshot", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.getByText("Snapshot proposal title")).toBeInTheDocument()
        })
    })

    it("renders the panel container", async () => {
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.getByTestId("featured-dao-panel")).toBeInTheDocument()
        })
    })
})

describe("FeaturedDaoPanel — snapshot usable but featuredDao empty", () => {
    beforeEach(() => {
        setupHappy()
    })

    afterEach(() => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: null,
            usable: false,
            isLoading: false,
        })
    })

    it("self-hides when snapshot featuredDao has blank realmPath", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: {
                featuredDao: {
                    realmPath: "",
                    name: "",
                    members: 0,
                    treasuryUgnot: BigInt(0),
                    openProposals: 0,
                    latestProposalTitle: "",
                },
            } as Parameters<typeof snapshotMod.useHomeSnapshot>[never],
            usable: true,
            isLoading: false,
        })
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.queryByTestId("featured-dao-panel")).not.toBeInTheDocument()
        })
    })

    it("self-hides when snapshot has no featuredDao field", async () => {
        vi.mocked(snapshotMod.useHomeSnapshot).mockReturnValue({
            snapshot: {} as Parameters<typeof snapshotMod.useHomeSnapshot>[never],
            usable: true,
            isLoading: false,
        })
        renderWithProviders(<FeaturedDaoPanel />)
        await waitFor(() => {
            expect(screen.queryByTestId("featured-dao-panel")).not.toBeInTheDocument()
        })
    })
})
