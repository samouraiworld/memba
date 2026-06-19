/**
 * CollectionPublic.test.tsx — TDD tests for the redesigned public collection page.
 *
 * Tests:
 * (a) Header + stats strip + the three tabs render
 * (b) A listed token's action opens TradeModal with action="buy", source="v3"
 * (c) An unlisted token's action opens TradeModal with action="offer"
 * (d) Token owned by viewer shows "List" action
 * (e) No wallet connected → "Connect wallet" hint shown
 * (f) Loading state renders gracefully
 * (g) Error state renders gracefully
 * (h) Admin sees "Manage in Studio" link
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

// ── Constants ─────────────────────────────────────────────────────────

const COL_ID = "g1creator/cool-nfts"
const ME = "g1viewer00000000000000000000000000001"
const ADMIN = "g1admin000000000000000000000000000001"
const TOKEN_OWNER_1 = "g1owner100000000000000000000000000001"

// ── Fixtures ──────────────────────────────────────────────────────────

const FIXTURE_DETAIL = {
    id: COL_ID,
    creator: "g1creator",
    admin: ADMIN,
    name: "Cool NFTs",
    symbol: "COOL",
    royaltyBps: 500,
    royaltyRecip: ADMIN,
    phase: 2,
    mintPrice: 1_000_000,
    payDenom: "ugnot",
    minted: 3,
    maxSupply: 100,
    paused: false,
}

const FIXTURE_STATS = {
    name: "Cool NFTs",
    symbol: "COOL",
    supply: 3n,
    floorPriceUgnot: 2_000_000n,
    totalVolumeUgnot: 10_000_000n,
    totalSales: 5n,
    activeListings: 1n,
    royaltyBps: 500n,
}

// Token 0: listed by TOKEN_OWNER_1
// Token 1: owned by TOKEN_OWNER_1, not listed
// Token 2: owned by viewer (ME), not listed
const FIXTURE_TOKENS = [
    { tokenId: "0", owner: TOKEN_OWNER_1, uri: "ipfs://token0" },
    { tokenId: "1", owner: TOKEN_OWNER_1, uri: "ipfs://token1" },
    { tokenId: "2", owner: ME, uri: "ipfs://token2" },
]

// listingKey uses "collectionID/tokenId" format
const LISTING_KEY_0 = `${COL_ID}/0`

const FIXTURE_LISTINGS = new Map([
    [LISTING_KEY_0, { priceUgnot: 2_000_000, seller: TOKEN_OWNER_1 }],
])

const FIXTURE_ACTIVITY = [
    {
        saleNo: 1n,
        tokenId: "0",
        kind: "sale",
        priceUgnot: 2_000_000n,
        seller: TOKEN_OWNER_1,
        buyer: ME,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
]

// ── Mock useCollectionPublic ──────────────────────────────────────────

const mockHookReturn = {
    detail: FIXTURE_DETAIL,
    stats: FIXTURE_STATS,
    tokens: FIXTURE_TOKENS,
    listings: FIXTURE_LISTINGS,
    activity: FIXTURE_ACTIVITY,
    loading: false,
    error: null,
    reload: vi.fn(),
}

vi.mock("./useCollectionPublic", () => ({
    useCollectionPublic: vi.fn(() => mockHookReturn),
}))

// ── Mock TradeModal as a render-spy ───────────────────────────────────

const capturedTradeProps: Record<string, unknown>[] = []

vi.mock("../components/nft/TradeModal", () => ({
    TradeModal: (props: Record<string, unknown>) => {
        capturedTradeProps.push(props)
        return (
            <div
                data-testid="trade-modal"
                data-action={props.action as string}
                data-source={props.source as string}
            >
                TradeModal:{props.action}
            </div>
        )
    },
}))

// ── Other dependency mocks ────────────────────────────────────────────

vi.mock("../components/nft/NFTMedia", () => ({
    NFTMedia: ({ alt }: { alt: string }) => <div data-testid="nft-media">{alt}</div>,
}))

vi.mock("../components/nft/VerifiedBadge", () => ({
    VerifiedBadge: ({ verified }: { verified: boolean }) =>
        verified ? <span aria-label="Verified collection">Verified</span> : null,
}))

vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkPath: () => (path: string) => `/test/${path}`,
}))

vi.mock("../lib/formatGnot", () => ({
    formatGnotCompact: (ugnot: bigint | number) => {
        const n = typeof ugnot === "bigint" ? Number(ugnot) : ugnot
        return `${n / 1_000_000} GNOT`
    },
}))

vi.mock("../lib/format", () => ({
    relativeTime: () => "1 min ago",
}))

vi.mock("../lib/v3TokenGrid", async (orig) => {
    const real = await orig<typeof import("../lib/v3TokenGrid")>()
    return {
        ...real,
    }
})

// ── Outlet context mock ───────────────────────────────────────────────

vi.mock("react-router-dom", async (orig) => {
    const real = await orig<typeof import("react-router-dom")>()
    return {
        ...real,
        useOutletContext: vi.fn(() => ({
            adena: { address: ME },
        })),
    }
})

// ── Helpers ──────────────────────────────────────────────────────────

import { CollectionPublic } from "./CollectionPublic"
import { useCollectionPublic } from "./useCollectionPublic"
import { useOutletContext } from "react-router-dom"

const mockUseHook = useCollectionPublic as ReturnType<typeof vi.fn>
const mockOutletCtx = useOutletContext as ReturnType<typeof vi.fn>

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/nft/collection/g1creator/cool-nfts"]}>
            <Routes>
                <Route path="/nft/collection/:creator/:slug" element={<CollectionPublic />} />
            </Routes>
        </MemoryRouter>,
    )
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks()
    capturedTradeProps.length = 0
    mockUseHook.mockReturnValue({ ...mockHookReturn, reload: vi.fn() })
    mockOutletCtx.mockReturnValue({ adena: { address: ME } })
})

describe("CollectionPublic — header", () => {
    it("renders the collection name", async () => {
        renderPage()
        await waitFor(() => {
            // NFTMedia mock also renders alt text, so multiple elements contain the name
            expect(screen.getAllByText(/Cool NFTs/).length).toBeGreaterThan(0)
        })
    })

    it("renders 'by {creator}'", async () => {
        renderPage()
        await waitFor(() => {
            expect(screen.getByText(/by g1creator/)).toBeInTheDocument()
        })
    })
})

describe("CollectionPublic — stats strip", () => {
    it("renders the four stat labels", async () => {
        renderPage()
        await waitFor(() => {
            // Use getAllByText since "Not listed" etc can also contain these terms
            expect(screen.getAllByText(/^Floor$/i).length).toBeGreaterThan(0)
            expect(screen.getAllByText(/^Volume$/i).length).toBeGreaterThan(0)
            expect(screen.getAllByText(/^Listed$/i).length).toBeGreaterThan(0)
            expect(screen.getAllByText(/^Supply$/i).length).toBeGreaterThan(0)
        })
    })

    it("renders floor price value", async () => {
        renderPage()
        await waitFor(() => {
            expect(screen.getAllByText(/2 GNOT/).length).toBeGreaterThan(0)
        })
    })

    it("renders gracefully when stats is null", async () => {
        mockUseHook.mockReturnValue({ ...mockHookReturn, stats: null, reload: vi.fn() })
        renderPage()
        await waitFor(() => {
            expect(screen.getAllByText(/Cool NFTs/).length).toBeGreaterThan(0)
        })
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })
})

describe("CollectionPublic — tabs", () => {
    it("renders Items, Activity, and About tabs", async () => {
        renderPage()
        await waitFor(() => {
            expect(screen.getByRole("tab", { name: /Items/i })).toBeInTheDocument()
            expect(screen.getByRole("tab", { name: /Activity/i })).toBeInTheDocument()
            expect(screen.getByRole("tab", { name: /About/i })).toBeInTheDocument()
        })
    })

    it("switches to Activity tab on click and shows activity", async () => {
        renderPage()
        await waitFor(() => {
            expect(screen.getByRole("tab", { name: /Activity/i })).toBeInTheDocument()
        })
        fireEvent.click(screen.getByRole("tab", { name: /Activity/i }))
        await waitFor(() => {
            // In Activity view, activity row shows kind="sale"
            expect(screen.getAllByText(/sale/i).length).toBeGreaterThan(0)
        })
    })

    it("switches to About tab on click", async () => {
        renderPage()
        await waitFor(() => {
            expect(screen.getByRole("tab", { name: /About/i })).toBeInTheDocument()
        })
        fireEvent.click(screen.getByRole("tab", { name: /About/i }))
        await waitFor(() => {
            expect(screen.getByText(/Royalty/i)).toBeInTheDocument()
        })
    })
})

describe("CollectionPublic — Items tab: listed token → Buy", () => {
    it("opens TradeModal with action='buy' and source='v3' for a listed token", async () => {
        renderPage()

        // Token #0 is listed — find its Buy button
        await waitFor(() => {
            expect(screen.getAllByRole("button", { name: /Buy/i }).length).toBeGreaterThan(0)
        })

        fireEvent.click(screen.getAllByRole("button", { name: /Buy/i })[0])

        await waitFor(() => {
            expect(screen.getByTestId("trade-modal")).toBeInTheDocument()
        })

        expect(capturedTradeProps.at(-1)).toMatchObject({
            action: "buy",
            source: "v3",
            collectionID: COL_ID,
            tokenId: "0",
            priceUgnot: 2_000_000,
            seller: TOKEN_OWNER_1,
        })
    })
})

describe("CollectionPublic — Items tab: unlisted token → Offer (OFFERS_ENABLED=false)", () => {
    it("does NOT render a Make-offer button for an unlisted token not owned by viewer (gated until Phase 3)", async () => {
        renderPage()

        // Token #1 is not listed, owned by TOKEN_OWNER_1 (not ME).
        // With OFFERS_ENABLED=false, no Make-offer button should appear and the
        // offer modal must not open. The "Not listed" label should still be visible.
        await waitFor(() => {
            expect(screen.getAllByText(/Cool NFTs/).length).toBeGreaterThan(0)
        })

        expect(screen.queryAllByRole("button", { name: /Make offer/i })).toHaveLength(0)
        expect(screen.queryByTestId("trade-modal")).not.toBeInTheDocument()
        expect(screen.getAllByText(/Not listed/i).length).toBeGreaterThan(0)
    })
})

describe("CollectionPublic — Items tab: owned token → List", () => {
    it("opens TradeModal with action='list' for a token owned by the viewer", async () => {
        renderPage()

        // Token #2 is owned by ME (viewer), not listed
        await waitFor(() => {
            expect(screen.getAllByRole("button", { name: /List/i }).length).toBeGreaterThan(0)
        })

        fireEvent.click(screen.getAllByRole("button", { name: /List/i })[0])

        await waitFor(() => {
            expect(screen.getByTestId("trade-modal")).toBeInTheDocument()
        })

        expect(capturedTradeProps.at(-1)).toMatchObject({
            action: "list",
            source: "v3",
            collectionID: COL_ID,
            tokenId: "2",
        })
    })
})

describe("CollectionPublic — wallet not connected", () => {
    it("shows 'Connect wallet' hint instead of action buttons when no address", async () => {
        mockOutletCtx.mockReturnValue({ adena: { address: "" } })
        renderPage()

        await waitFor(() => {
            expect(screen.getAllByText(/Cool NFTs/).length).toBeGreaterThan(0)
        })

        // No action buttons rendered without wallet
        expect(screen.queryAllByRole("button", { name: /Buy|List|Make offer/i })).toHaveLength(0)
        expect(screen.getAllByText(/Connect wallet/i).length).toBeGreaterThan(0)
    })
})

describe("CollectionPublic — loading state", () => {
    it("renders loading text when loading=true", () => {
        mockUseHook.mockReturnValue({
            ...mockHookReturn,
            loading: true,
            detail: null,
            reload: vi.fn(),
        })
        renderPage()
        expect(screen.getByText(/Loading/i)).toBeInTheDocument()
    })
})

describe("CollectionPublic — error state", () => {
    it("renders error message and does not crash", async () => {
        mockUseHook.mockReturnValue({
            ...mockHookReturn,
            loading: false,
            detail: null,
            error: "Collection not found",
            reload: vi.fn(),
        })
        renderPage()
        await waitFor(() => {
            expect(screen.getByRole("alert")).toBeInTheDocument()
        })
        expect(screen.getByText(/Collection not found/i)).toBeInTheDocument()
    })
})

describe("CollectionPublic — admin affordance", () => {
    it("shows 'Manage in Studio' link when viewer is admin", async () => {
        mockOutletCtx.mockReturnValue({ adena: { address: ADMIN } })
        renderPage()

        await waitFor(() => {
            expect(screen.getByRole("link", { name: /Manage in Studio/i })).toBeInTheDocument()
        })
    })

    it("hides 'Manage in Studio' link when viewer is not admin", async () => {
        renderPage()

        await waitFor(() => {
            expect(screen.getAllByText(/Cool NFTs/).length).toBeGreaterThan(0)
        })

        expect(screen.queryByRole("link", { name: /Manage in Studio/i })).not.toBeInTheDocument()
    })
})
