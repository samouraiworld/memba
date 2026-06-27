/**
 * MarketplaceHub.test.tsx — TDD tests for the NFT discovery hub page.
 *
 * Tests:
 * (a) Verified collection cards render
 * (b) Search input filters rendered cards
 * (c) Activity rows render
 * (d) Rejected fetchVerifiedCollections shows error state (not a perpetual loader)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { MarketplaceHub } from "./MarketplaceHub"

// ── Mock dependencies ────────────────────────────────────────────────

vi.mock("../lib/nftHub", () => ({
    fetchVerifiedCollections: vi.fn(),
    fetchRecentActivity: vi.fn(),
}))

vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkPath: () => (path: string) => `/test/${path}`,
    useNetworkKey: () => "test13",
}))

// Lane-registry predicates — vi.fn so tests can flip lane liveness. Default: NFT lane
// live (so the hub renders), Services lane off (no tabs unless a test enables it).
vi.mock("../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/config")>()),
    isNftEnabled: vi.fn(() => true),
    isNftMarketValid: vi.fn(() => true),
    isNftMarketV3Valid: vi.fn(() => true),
    isServicesEnabled: vi.fn(() => false),
    isEscrowValid: vi.fn(() => false),
}))
const configMod = await import("../lib/config")

// NFTMedia renders placeholder for empty URI — acceptable for tests
vi.mock("../components/nft/NFTMedia", () => ({
    NFTMedia: ({ alt }: { alt: string }) => <div data-testid="nft-media">{alt}</div>,
}))

// ── Fixtures ─────────────────────────────────────────────────────────

const FIXTURE_COLLECTIONS = [
    {
        id: "g1creator/alpha-apes",
        name: "Alpha Apes",
        creator: "g1creator",
        slug: "alpha-apes",
        verified: true,
        floorUgnot: 2_000_000n,
        volumeUgnot: 50_000_000n,
    },
    {
        id: "g1creator/beta-cats",
        name: "Beta Cats",
        creator: "g1creator",
        slug: "beta-cats",
        verified: false,
        floorUgnot: 500_000n,
        volumeUgnot: 10_000_000n,
    },
]

const FIXTURE_ACTIVITY = [
    {
        saleNo: 1n,
        tokenId: "42",
        kind: "sale",
        priceUgnot: 2_000_000n,
        seller: "g1seller1234567890123456789012",
        buyer: "g1buyer12345678901234567890123",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
    {
        saleNo: 2n,
        tokenId: "7",
        kind: "offer-accepted",
        priceUgnot: 1_500_000n,
        seller: "g1sellerAbcde1234567890123456",
        buyer: "g1buyerAbcde12345678901234567",
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
    },
]

// ── Helpers ──────────────────────────────────────────────────────────

import { fetchVerifiedCollections, fetchRecentActivity } from "../lib/nftHub"
const mockFetchCollections = fetchVerifiedCollections as ReturnType<typeof vi.fn>
const mockFetchActivity = fetchRecentActivity as ReturnType<typeof vi.fn>

function renderHub() {
    return render(
        <MemoryRouter>
            <MarketplaceHub />
        </MemoryRouter>,
    )
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCollections.mockResolvedValue(FIXTURE_COLLECTIONS)
    mockFetchActivity.mockResolvedValue(FIXTURE_ACTIVITY)
    // Reset lane-registry predicates to defaults (mockReturnValue persists across
    // clearAllMocks, so a prior test's override would otherwise leak): NFT live,
    // Services off → one lane, no tabs.
    ;(configMod.isNftEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(configMod.isNftMarketV3Valid as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(configMod.isServicesEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(configMod.isEscrowValid as ReturnType<typeof vi.fn>).mockReturnValue(false)
})

describe("MarketplaceHub — collection cards", () => {
    it("renders a card for each collection", async () => {
        renderHub()

        await waitFor(() => {
            // Use getAllByText since NFTMedia mock also renders the name as alt text
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })
        expect(screen.getAllByText("Beta Cats").length).toBeGreaterThan(0)
    })

    it("shows the verified badge only on verified collections", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })

        // VerifiedBadge renders "✔︎ Verified" or similar; we test aria-label
        const badges = screen.queryAllByRole("img", { name: /verified/i })
        expect(badges.length).toBe(1)
    })

    it("links each card to the collection detail page", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })

        const link = screen.getByRole("link", { name: /alpha apes/i })
        expect(link).toHaveAttribute("href", "/test/nft/collection/g1creator/alpha-apes")
    })

    it("the verified-only toggle hides unverified collections", async () => {
        renderHub()

        await waitFor(() => expect(screen.getByRole("link", { name: /beta cats/i })).toBeInTheDocument())
        expect(screen.getByRole("link", { name: /alpha apes/i })).toBeInTheDocument()

        fireEvent.click(screen.getByRole("checkbox", { name: /verified/i }))

        // Beta Cats is unverified → its card is filtered out; Alpha Apes (verified) stays.
        expect(screen.queryByRole("link", { name: /beta cats/i })).not.toBeInTheDocument()
        expect(screen.getByRole("link", { name: /alpha apes/i })).toBeInTheDocument()
    })

    it("displays floor and volume for each collection", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })

        // formatGnotCompact(2_000_000n) = "2 GNOT"
        const floors = screen.getAllByText(/2 GNOT/)
        expect(floors.length).toBeGreaterThan(0)
    })
})

describe("MarketplaceHub — search filter", () => {
    it("renders a search input", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })

        expect(screen.getByRole("searchbox")).toBeInTheDocument()
    })

    it("filters cards by name when the user types", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "alpha" } })

        // Alpha Apes cards remain (in card name span)
        expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        // Beta Cats should be gone — queryAllByText returns [] when absent
        expect(screen.queryAllByText("Beta Cats").length).toBe(0)
    })

    it("shows empty state when no collections match the search query", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzznomatch" } })

        expect(screen.queryAllByText("Alpha Apes").length).toBe(0)
        expect(screen.queryAllByText("Beta Cats").length).toBe(0)
        expect(screen.getByText(/no collections/i)).toBeInTheDocument()
    })
})

describe("MarketplaceHub — activity feed", () => {
    it("renders a row for each activity item", async () => {
        renderHub()

        await waitFor(() => {
            // Token #42 appears in both the span text and the NFTMedia alt mock
            expect(screen.getAllByText(/Token #42/).length).toBeGreaterThan(0)
        })
        expect(screen.getAllByText(/Token #7/).length).toBeGreaterThan(0)
    })

    it("displays the price for each activity row", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText(/Token #42/).length).toBeGreaterThan(0)
        })

        // formatGnotCompact(2_000_000n) = "2 GNOT"
        const prices = screen.getAllByText(/2 GNOT/)
        expect(prices.length).toBeGreaterThan(0)
    })

    it("renders NFTMedia placeholder for each activity row", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText(/Token #42/).length).toBeGreaterThan(0)
        })

        const thumbs = screen.getAllByTestId("nft-media")
        // 2 collection thumbs + 2 activity thumbs = 4 total
        expect(thumbs.length).toBeGreaterThanOrEqual(FIXTURE_ACTIVITY.length)
    })
})

describe("MarketplaceHub — activity error state", () => {
    it("shows 'Activity unavailable' when fetchRecentActivity rejects, not 'No recent activity.'", async () => {
        mockFetchActivity.mockRejectedValue(new Error("timeout"))
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })

        expect(screen.getByText(/activity unavailable/i)).toBeInTheDocument()
        expect(screen.queryByText(/no recent activity/i)).not.toBeInTheDocument()
    })
})

describe("MarketplaceHub — loading state", () => {
    it("shows a loading indicator before data resolves", () => {
        mockFetchCollections.mockReturnValue(new Promise(() => {}))
        renderHub()

        expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })
})

describe("MarketplaceHub — empty state", () => {
    it("shows an empty state when no collections exist", async () => {
        mockFetchCollections.mockResolvedValue([])
        mockFetchActivity.mockResolvedValue([])
        renderHub()

        await waitFor(() => {
            expect(screen.getByText(/no collections/i)).toBeInTheDocument()
        })
    })
})

describe("MarketplaceHub — unified shell (lanes + URL state)", () => {
    const mockV3 = configMod.isNftMarketV3Valid as ReturnType<typeof vi.fn>
    const mockSvcEnabled = configMod.isServicesEnabled as ReturnType<typeof vi.fn>
    const mockEscrow = configMod.isEscrowValid as ReturnType<typeof vi.fn>

    it("shows the gate (no trade surface) when no lane is live", () => {
        mockV3.mockReturnValue(false) // NFT not live; services already off
        renderHub()
        // The gated front door has no search/trade surface.
        expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
        expect(screen.getByText(/one marketplace, enforced on-chain royalties/i)).toBeInTheDocument()
    })

    it("renders no tabs when only one lane is live", async () => {
        mockV3.mockReturnValue(true) // only NFT
        renderHub()
        await waitFor(() => expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0))
        expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    })

    it("renders a tab per live lane and switches lane on click", async () => {
        mockV3.mockReturnValue(true)
        mockSvcEnabled.mockReturnValue(true)
        mockEscrow.mockReturnValue(true) // both NFT + Services live
        renderHub()

        await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument())
        const tabs = screen.getAllByRole("tab")
        expect(tabs.map((t) => t.textContent)).toEqual(["NFTs", "Services"])

        // NFT lane is active by default → collections load
        await waitFor(() => expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0))

        // Switch to Services → its placeholder shows, NFT content gone
        fireEvent.click(screen.getByRole("tab", { name: "Services" }))
        expect(screen.getByText(/coming in the next release/i)).toBeInTheDocument()
    })
})

describe("MarketplaceHub — error state", () => {
    it("shows an error message and does NOT stay on loading when fetchVerifiedCollections rejects", async () => {
        mockFetchCollections.mockRejectedValue(new Error("Network failure"))
        renderHub()

        // Must NOT stay on loading forever
        await waitFor(() => {
            expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
        })

        // Must show an error indicator
        expect(screen.getByRole("alert")).toBeInTheDocument()
        expect(screen.getByText(/network failure/i)).toBeInTheDocument()
    })
})

describe("MarketplaceHub — header", () => {
    it("renders a 'Launch a collection' link pointing to nft/create", async () => {
        renderHub()

        await waitFor(() => {
            expect(screen.getAllByText("Alpha Apes").length).toBeGreaterThan(0)
        })

        const link = screen.getByRole("link", { name: /launch a collection/i })
        expect(link).toHaveAttribute("href", "/test/nft/create")
    })
})

describe("MarketplaceHub — feature gate", () => {
    it("renders the ComingSoonGate (not the live hub) when NFT is disabled", () => {
        vi.mocked(configMod.isNftEnabled).mockReturnValueOnce(false)
        renderHub()
        // Gate is shown: no live hub search box, and the gate's feature copy is present.
        expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
        expect(screen.getByText(/enforced on-chain royalties/i)).toBeInTheDocument()
    })

    it("renders the ComingSoonGate when the market realm is invalid on this network", () => {
        vi.mocked(configMod.isNftMarketValid).mockReturnValueOnce(false)
        renderHub()
        expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
    })
})
