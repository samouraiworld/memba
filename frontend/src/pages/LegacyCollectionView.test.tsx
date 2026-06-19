/**
 * LegacyCollectionView.test.tsx — TDD tests for the read-only legacy v1 viewer.
 *
 * Tests:
 * (a) Renders collection header (name, symbol, totalSupply) and sanitized render output.
 * (b) Shows "Legacy collection — read only" banner.
 * (c) NO mint form present.
 * (d) NO trade/approve buttons present (buy, offer, list, delist, approve).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { LegacyCollectionView } from "./LegacyCollectionView"

// ── Mock dependencies ────────────────────────────────────────────────

vi.mock("../lib/grc721", () => ({
    getCollectionInfo: vi.fn(),
}))

vi.mock("../lib/dao/shared", () => ({
    queryRender: vi.fn(),
}))

vi.mock("../lib/config", () => ({
    GNO_RPC_URL: "https://rpc.test.gno.land",
    getExplorerBaseUrl: () => "https://gnoscan.io/r",
}))

// ── Fixtures ─────────────────────────────────────────────────────────

const FIXTURE_COLLECTION = {
    realmPath: "gno.land/r/test/mynft",
    name: "My Legacy NFTs",
    symbol: "MNFT",
    totalSupply: 42,
    creator: "g1creator1234567890123456789012",
    description: "A legacy v1 NFT collection.",
    royaltyPercent: 5,
}

const FIXTURE_RENDER_OUTPUT = "# My Gallery\n## Tokens\nToken A\nToken B"

// ── Helpers ──────────────────────────────────────────────────────────

import { getCollectionInfo } from "../lib/grc721"
import { queryRender } from "../lib/dao/shared"
const mockGetCollectionInfo = getCollectionInfo as ReturnType<typeof vi.fn>
const mockQueryRender = queryRender as ReturnType<typeof vi.fn>

function renderView(realmPath = "gno.land%2Fr%2Ftest%2Fmynft") {
    return render(
        <MemoryRouter initialEntries={[`/nft/${realmPath}`]}>
            <Routes>
                <Route path="/nft/:realmPath" element={<LegacyCollectionView />} />
            </Routes>
        </MemoryRouter>,
    )
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks()
    mockGetCollectionInfo.mockResolvedValue(FIXTURE_COLLECTION)
    mockQueryRender.mockResolvedValue(FIXTURE_RENDER_OUTPUT)
})

describe("LegacyCollectionView — collection header", () => {
    it("renders the collection name", async () => {
        renderView()
        await waitFor(() => {
            expect(screen.getByText("My Legacy NFTs")).toBeInTheDocument()
        })
    })

    it("renders the collection symbol", async () => {
        renderView()
        await waitFor(() => {
            expect(screen.getByText(/MNFT/)).toBeInTheDocument()
        })
    })

    it("renders the total supply", async () => {
        renderView()
        await waitFor(() => {
            expect(screen.getByText(/42/)).toBeInTheDocument()
        })
    })
})

describe("LegacyCollectionView — legacy banner", () => {
    it("shows the 'Legacy collection — read only' banner", async () => {
        renderView()
        await waitFor(() => {
            expect(screen.getByText(/legacy collection.*read only/i)).toBeInTheDocument()
        })
    })
})

describe("LegacyCollectionView — sanitized render output", () => {
    it("renders the on-chain render output section", async () => {
        renderView()
        await waitFor(() => {
            expect(screen.getByText(/My Gallery/i)).toBeInTheDocument()
        })
    })

    it("calls queryRender with GNO_RPC_URL and decoded realmPath", async () => {
        renderView()
        await waitFor(() => {
            expect(mockQueryRender).toHaveBeenCalledWith(
                "https://rpc.test.gno.land",
                "gno.land/r/test/mynft",
                "",
            )
        })
    })

    it("calls getCollectionInfo with the decoded realmPath", async () => {
        renderView()
        await waitFor(() => {
            expect(mockGetCollectionInfo).toHaveBeenCalledWith("gno.land/r/test/mynft")
        })
    })
})

describe("LegacyCollectionView — read-only: no write UI", () => {
    it("does NOT render a mint form", async () => {
        renderView()
        await waitFor(() => {
            expect(screen.getByText("My Legacy NFTs")).toBeInTheDocument()
        })
        expect(screen.queryByPlaceholderText(/token id/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/^mint$/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/minting/i)).not.toBeInTheDocument()
    })

    it("does NOT render trade buttons (buy, offer, list, delist, approve)", async () => {
        renderView()
        await waitFor(() => {
            expect(screen.getByText("My Legacy NFTs")).toBeInTheDocument()
        })
        expect(screen.queryByRole("button", { name: /buy/i })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /offer/i })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /list for sale/i })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /delist/i })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument()
    })

    it("does NOT render a mint section heading", async () => {
        renderView()
        await waitFor(() => {
            expect(screen.getByText("My Legacy NFTs")).toBeInTheDocument()
        })
        expect(screen.queryByText(/mint nft/i)).not.toBeInTheDocument()
    })
})

describe("LegacyCollectionView — null collection graceful fallback", () => {
    it("shows realm path segment as fallback name when collection is null", async () => {
        mockGetCollectionInfo.mockResolvedValue(null)
        renderView()
        await waitFor(() => {
            // falls back to last segment of realmPath
            expect(screen.getByText("mynft")).toBeInTheDocument()
        })
    })
})

describe("LegacyCollectionView — loading state", () => {
    it("shows a loading indicator while data is fetching", () => {
        mockGetCollectionInfo.mockReturnValue(new Promise(() => {}))
        mockQueryRender.mockReturnValue(new Promise(() => {}))
        renderView()
        // Something that indicates loading is visible immediately
        expect(screen.getByTestId("lcv-loading")).toBeInTheDocument()
    })
})

describe("LegacyCollectionView — error state", () => {
    it("shows an error alert and no skeleton when the load rejects", async () => {
        mockGetCollectionInfo.mockRejectedValue(new Error("network failure"))
        renderView()
        await waitFor(() => {
            expect(screen.getByRole("alert")).toBeInTheDocument()
        })
        expect(screen.getByRole("alert")).toHaveTextContent("network failure")
        expect(screen.queryByTestId("lcv-loading")).not.toBeInTheDocument()
    })
})
