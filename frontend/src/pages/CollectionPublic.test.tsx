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
    minted: 4,
    maxSupply: 100,
    paused: false,
}

const FIXTURE_STATS = {
    name: "Cool NFTs",
    symbol: "COOL",
    supply: 4n,
    floorPriceUgnot: 2_000_000n,
    totalVolumeUgnot: 10_000_000n,
    totalSales: 5n,
    activeListings: 1n,
    royaltyBps: 500n,
}

// Token 0: listed by TOKEN_OWNER_1
// Token 1: owned by TOKEN_OWNER_1, not listed, MY offer (→ cancel)
// Token 2: owned by viewer (ME), not listed
// Token 3: owned by TOKEN_OWNER_1, not listed, no offer (→ make offer)
const FIXTURE_TOKENS = [
    { tokenId: "0", owner: TOKEN_OWNER_1, uri: "ipfs://token0" },
    { tokenId: "1", owner: TOKEN_OWNER_1, uri: "ipfs://token1" },
    { tokenId: "2", owner: ME, uri: "ipfs://token2" },
    { tokenId: "3", owner: TOKEN_OWNER_1, uri: "ipfs://token3" },
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

// Token #2 (owned by ME) has a standing offer → owner can accept.
// Token #0 (listed, owned by someone else) has a standing offer → buyer sees the badge.
// Token #1 (unlisted, owned by someone else) has MY standing offer → I can cancel it.
const OFFER_BUYER = "g1buyer00000000000000000000000000009"
const FIXTURE_OFFERS = new Map([
    ["0", [{ buyer: "g1buyerA0000000000000000000000000001", amountUgnot: 1_500_000, createdBlk: 90 }]],
    ["1", [{ buyer: ME, amountUgnot: 2_000_000, createdBlk: 95 }]],
    ["2", [{ buyer: OFFER_BUYER, amountUgnot: 3_000_000, createdBlk: 100 }]],
])

const mockHookReturn = {
    detail: FIXTURE_DETAIL,
    stats: FIXTURE_STATS,
    tokens: FIXTURE_TOKENS,
    listings: FIXTURE_LISTINGS,
    offers: FIXTURE_OFFERS,
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

// Bypass the NFT feature gate so the page content (not ComingSoonGate) renders.
vi.mock("../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/config")>()),
    isNftEnabled: () => true,
    // The page trades source="v3", so its gate keys off isNftMarketV3Valid (W0.1).
    // Mock it true so these render/trade tests exercise the live page, not the gate.
    isNftMarketV3Valid: () => true,
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

describe("CollectionPublic — Items tab: unlisted token → Offer", () => {
    it("opens TradeModal with action='offer' for an unlisted token not owned by the viewer (no prior offer)", async () => {
        renderPage()

        // Token #3 is not listed, owned by TOKEN_OWNER_1 (not ME), with no offer from ME
        // → a non-owner sees a Make-offer button.
        await waitFor(() => {
            expect(screen.getAllByRole("button", { name: /Make offer/i }).length).toBeGreaterThan(0)
        })

        fireEvent.click(screen.getAllByRole("button", { name: /Make offer/i })[0])

        await waitFor(() => {
            expect(screen.getByTestId("trade-modal")).toBeInTheDocument()
        })

        expect(capturedTradeProps.at(-1)).toMatchObject({
            action: "offer",
            source: "v3",
            collectionID: COL_ID,
            tokenId: "3",
        })
    })
})

describe("CollectionPublic — Items tab: my standing offer → Cancel", () => {
    it("shows 'Cancel offer' (not 'Make offer') and opens TradeModal action='cancel' for a token the viewer has offered on", async () => {
        renderPage()

        // Token #1: unlisted, owned by TOKEN_OWNER_1, with MY 2 GNOT offer → I can cancel.
        await waitFor(() => {
            expect(screen.getAllByRole("button", { name: /Cancel offer/i }).length).toBeGreaterThan(0)
        })

        fireEvent.click(screen.getAllByRole("button", { name: /Cancel offer/i })[0])

        await waitFor(() => {
            expect(screen.getByTestId("trade-modal")).toBeInTheDocument()
        })

        expect(capturedTradeProps.at(-1)).toMatchObject({
            action: "cancel",
            source: "v3",
            collectionID: COL_ID,
            tokenId: "1",
            priceUgnot: 2_000_000,
        })
    })
})

describe("CollectionPublic — buyer-facing best-offer badge", () => {
    it("shows the best standing offer on a listed token the viewer does not own", async () => {
        renderPage()

        // Token #0 is listed (owned by TOKEN_OWNER_1, not ME) and has a 1.5 GNOT offer.
        await waitFor(() => {
            expect(screen.getByText(/Offer 1\.5 GNOT/)).toBeInTheDocument()
        })
    })
})

describe("CollectionPublic — Items tab: owned token with offer → Accept", () => {
    it("opens TradeModal with action='accept' and the best offer's buyer for an owned token", async () => {
        renderPage()

        // Token #2 is owned by ME and has a standing 3 GNOT offer from OFFER_BUYER.
        await waitFor(() => {
            expect(screen.getAllByRole("button", { name: /Accept/i }).length).toBeGreaterThan(0)
        })

        fireEvent.click(screen.getAllByRole("button", { name: /Accept/i })[0])

        await waitFor(() => {
            expect(screen.getByTestId("trade-modal")).toBeInTheDocument()
        })

        expect(capturedTradeProps.at(-1)).toMatchObject({
            action: "accept",
            source: "v3",
            collectionID: COL_ID,
            tokenId: "2",
            buyerAddr: OFFER_BUYER,
        })
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
