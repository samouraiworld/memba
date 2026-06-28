import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const COL_ID = "g1creator/cool-nfts"
const ME = "g1viewer00000000000000000000000000001"
const OWNER1 = "g1owner100000000000000000000000000001"

const FIXTURE = {
    detail: { id: COL_ID, name: "Cool NFTs", creator: "g1creator", admin: "g1admin", royaltyBps: 500, minted: 2, symbol: "COOL", maxSupply: 0 },
    stats: null,
    tokens: [
        { tokenId: "0", owner: OWNER1, uri: "ipfs://t0" },
        { tokenId: "1", owner: ME, uri: "ipfs://t1" },
    ],
    listings: new Map([[`${COL_ID}/0`, { priceUgnot: 2_000_000, seller: OWNER1 }]]),
    offers: new Map(),
    activity: [],
    verified: true,
    loading: false,
    error: null,
    reload: vi.fn(),
}

const mockHook = vi.fn(() => FIXTURE)
vi.mock("./useCollectionPublic", () => ({ useCollectionPublic: (...a: unknown[]) => mockHook(...a) }))

const captured: Record<string, unknown>[] = []
vi.mock("../components/nft/TradeModal", () => ({
    TradeModal: (p: Record<string, unknown>) => {
        captured.push(p)
        return <div data-testid="trade-modal" data-action={p.action as string}>modal:{p.action as string}</div>
    },
}))
vi.mock("../components/nft/NFTMedia", () => ({ NFTMedia: ({ alt }: { alt: string }) => <div data-testid="art">{alt}</div> }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkPath: () => (p: string) => `/test/${p}` }))
vi.mock("../lib/config", async (orig) => ({ ...(await orig<typeof import("../lib/config")>()), isNftEnabled: () => true, isNftMarketV3Valid: () => true }))
vi.mock("react-router-dom", async (orig) => {
    const real = await orig<typeof import("react-router-dom")>()
    return { ...real, useOutletContext: () => ({ adena: { address: ME } }) }
})

import { TokenDetail } from "./TokenDetail"

function renderAt(tokenId: string) {
    return render(
        <MemoryRouter initialEntries={[`/nft/token/g1creator/cool-nfts/${tokenId}`]}>
            <Routes>
                <Route path="/nft/token/:creator/:slug/:tokenId" element={<TokenDetail />} />
            </Routes>
        </MemoryRouter>,
    )
}

beforeEach(() => {
    captured.length = 0
    mockHook.mockReturnValue(FIXTURE)
})

describe("TokenDetail", () => {
    it("renders the token identity and owner", async () => {
        renderAt("0")
        await waitFor(() => expect(screen.getByRole("heading", { name: /Cool NFTs #0/ })).toBeInTheDocument())
        // owner OWNER1 shown (copyable, truncated)
        expect(screen.getByText(/g1ow…001/)).toBeInTheDocument()
    })

    it("a listed token not owned by the viewer offers Buy → TradeModal action='buy'", async () => {
        renderAt("0")
        const buy = await screen.findByRole("button", { name: /^Buy/i })
        fireEvent.click(buy)
        await waitFor(() => expect(screen.getByTestId("trade-modal")).toBeInTheDocument())
        expect(captured.at(-1)).toMatchObject({ action: "buy", tokenId: "0", collectionID: COL_ID })
    })

    it("links back to the collection", async () => {
        renderAt("0")
        await waitFor(() => expect(screen.getByRole("heading", { name: /Cool NFTs #0/ })).toBeInTheDocument())
        const links = screen.getAllByRole("link", { name: /Cool NFTs/i })
        expect(links.some((l) => l.getAttribute("href") === "/test/nft/collection/g1creator/cool-nfts")).toBe(true)
    })

    it("shows a not-found message for a missing token id", async () => {
        renderAt("99")
        await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument())
    })
})
