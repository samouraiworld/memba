/**
 * TradeModal.test.tsx — TDD tests for the unified engine-routed TradeModal.
 *
 * Tests assert call args to the mocked builders and doContractBroadcast.
 * isApprovedForAll is mocked to control the list two-step.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { TradeModal } from "./TradeModal"
import { NFT_MARKET_V3_ADDR } from "../../lib/nftConfig"

// ── Shared test fixtures ───────────────────────────────────────

const CALLER = "g1caller000000000000000000000000000000"
const COLLECTION_ID = "col-abc"
const TOKEN_ID = "token-1"
const PRICE_UGNOT = 2_000_000
const BUYER_ADDR = "g1buyer000000000000000000000000000000"
const ROYALTY_BPS = 500

// ── Mock builder modules ───────────────────────────────────────

const mockBuildBuyNFTV3Msg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildBuyNFTMsg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildListForSaleV3Msg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildListForSaleMsg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildMakeOfferV3Msg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildMakeOfferMsg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildAcceptOfferV3Msg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildAcceptOfferMsg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildCancelOfferV3Msg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildCancelOfferMsg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildSetApprovalForAllV3Msg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })
const mockBuildSetApprovalForAllMsg = vi.fn().mockReturnValue({ type: "vm/MsgCall", value: {} })

vi.mock("../../lib/nftMarketplaceV3", () => ({
    buildBuyNFTV3Msg: (...args: unknown[]) => mockBuildBuyNFTV3Msg(...args),
    buildListForSaleV3Msg: (...args: unknown[]) => mockBuildListForSaleV3Msg(...args),
    buildMakeOfferV3Msg: (...args: unknown[]) => mockBuildMakeOfferV3Msg(...args),
    buildAcceptOfferV3Msg: (...args: unknown[]) => mockBuildAcceptOfferV3Msg(...args),
    buildCancelOfferV3Msg: (...args: unknown[]) => mockBuildCancelOfferV3Msg(...args),
    buildSetApprovalForAllV3Msg: (...args: unknown[]) => mockBuildSetApprovalForAllV3Msg(...args),
}))

vi.mock("../../lib/nftMarketplace", () => ({
    buildBuyNFTMsg: (...args: unknown[]) => mockBuildBuyNFTMsg(...args),
    buildListForSaleMsg: (...args: unknown[]) => mockBuildListForSaleMsg(...args),
    buildMakeOfferMsg: (...args: unknown[]) => mockBuildMakeOfferMsg(...args),
    buildAcceptOfferMsg: (...args: unknown[]) => mockBuildAcceptOfferMsg(...args),
    buildCancelOfferMsg: (...args: unknown[]) => mockBuildCancelOfferMsg(...args),
    buildSetApprovalForAllMsg: (...args: unknown[]) => mockBuildSetApprovalForAllMsg(...args),
}))

const mockDoContractBroadcast = vi.fn().mockResolvedValue(undefined)
vi.mock("../../lib/grc20", () => ({
    doContractBroadcast: (...args: unknown[]) => mockDoContractBroadcast(...args),
}))

const mockIsApprovedForAll = vi.fn()
vi.mock("../../lib/grc721", () => ({
    isApprovedForAll: (...args: unknown[]) => mockIsApprovedForAll(...args),
}))

// The fee row reads the DAO-set rate from memba_market_config. Mock it to a value
// distinct from the engine default (200) so a test can prove the live read wins.
const mockFetchLaneFeeBps = vi.fn().mockResolvedValue(300)
vi.mock("../../lib/marketplace/v3Reads", () => ({
    fetchLaneFeeBps: (...args: unknown[]) => mockFetchLaneFeeBps(...args),
}))

// The v3 trade actions now route through routeNftV3, which guards on
// isRealmValid(v3 path). On test13 the v3 path is intentionally un-allowlisted, so
// mock the guard true to exercise the builders (the gate itself is tested in router.test).
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isRealmValid: () => true,
}))

// ── Helpers ────────────────────────────────────────────────────

function makeProps(overrides: Partial<Parameters<typeof TradeModal>[0]> = {}) {
    return {
        action: "buy" as const,
        source: "v3" as const,
        collectionID: COLLECTION_ID,
        tokenId: TOKEN_ID,
        priceUgnot: PRICE_UGNOT,
        seller: "g1seller0000000000000000000000000000",
        royaltyBps: ROYALTY_BPS,
        callerAddress: CALLER,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    mockIsApprovedForAll.mockResolvedValue(true) // default: already approved
})

// ── Tests ──────────────────────────────────────────────────────

describe("TradeModal — buy (v3)", () => {
    it("(a) calls buildBuyNFTV3Msg with (caller, collectionID, tokenId, priceUgnot) then broadcasts", async () => {
        const onSuccess = vi.fn()
        render(<TradeModal {...makeProps({ action: "buy", source: "v3", onSuccess })} />)

        const confirmBtn = screen.getByRole("button", { name: /confirm purchase/i })
        fireEvent.click(confirmBtn)

        await waitFor(() => expect(mockDoContractBroadcast).toHaveBeenCalledOnce())

        expect(mockBuildBuyNFTV3Msg).toHaveBeenCalledWith(CALLER, COLLECTION_ID, TOKEN_ID, PRICE_UGNOT)
        expect(mockDoContractBroadcast).toHaveBeenCalledWith(
            [expect.any(Object)],
            expect.stringContaining(COLLECTION_ID),
        )
        expect(onSuccess).toHaveBeenCalled()
    })

    it("shows PriceBreakdown with price, fee and royalty rows", () => {
        render(<TradeModal {...makeProps({ action: "buy", source: "v3" })} />)

        // PriceBreakdown renders "Price", "Platform Fee", "Creator Royalty", "Seller Receives"
        expect(screen.getByText("Price")).toBeInTheDocument()
        expect(screen.getByText(/Platform Fee/)).toBeInTheDocument()
        expect(screen.getByText(/Creator Royalty/)).toBeInTheDocument()
        expect(screen.getByText("Seller Receives")).toBeInTheDocument()
    })

    it("fee row mirrors the on-chain rate from memba_market_config (not the static default)", async () => {
        render(<TradeModal {...makeProps({ action: "buy", source: "v3" })} />)

        // fetchLaneFeeBps("nft") resolves to 300 → the breakdown must show 3.0%, not 2.0%.
        expect(mockFetchLaneFeeBps).toHaveBeenCalledWith("nft")
        await waitFor(() => expect(screen.getByText(/Platform Fee \(3\.0%\)/)).toBeInTheDocument())
    })
})

describe("TradeModal — buy (v2)", () => {
    it("(b) calls buildBuyNFTMsg with v2 marketPath (not v3 builder)", async () => {
        render(<TradeModal {...makeProps({ action: "buy", source: "v2" })} />)

        const confirmBtn = screen.getByRole("button", { name: /confirm purchase/i })
        fireEvent.click(confirmBtn)

        await waitFor(() => expect(mockDoContractBroadcast).toHaveBeenCalledOnce())

        // Must use v2 builder with the v2 marketPath from tradeEngineFor("v2")
        expect(mockBuildBuyNFTMsg).toHaveBeenCalledWith(
            CALLER,
            expect.stringContaining("gno.land"), // v2 marketPath from tradeEngine
            COLLECTION_ID,
            TOKEN_ID,
            PRICE_UGNOT,
        )
        // v3 builder must NOT be called
        expect(mockBuildBuyNFTV3Msg).not.toHaveBeenCalled()
    })
})

describe("TradeModal — list (v3, not approved)", () => {
    it("(c) first confirm click builds approval msg, not listing msg", async () => {
        mockIsApprovedForAll.mockResolvedValue(false) // NOT approved

        render(<TradeModal {...makeProps({ action: "list", source: "v3" })} />)

        // Wait for the approval step to render (after isApprovedForAll resolves)
        const approveBtn = await screen.findByRole("button", { name: /approve marketplace/i })
        fireEvent.click(approveBtn)

        await waitFor(() => expect(mockDoContractBroadcast).toHaveBeenCalledOnce())

        // The first broadcast must be approval with the correct arg order, NOT listing.
        // v3 signature: buildSetApprovalForAllV3Msg(caller, collectionID, operatorAddr, approved)
        // operator = engine.marketAddr = NFT_MARKET_V3_ADDR (the v3.1 engine address).
        expect(mockBuildSetApprovalForAllV3Msg).toHaveBeenCalledWith(
            CALLER,
            COLLECTION_ID,
            NFT_MARKET_V3_ADDR,
            true,
        )
        expect(mockBuildListForSaleV3Msg).not.toHaveBeenCalled()
    })

    it("when already approved, skips directly to list step", async () => {
        mockIsApprovedForAll.mockResolvedValue(true) // already approved

        render(<TradeModal {...makeProps({ action: "list", source: "v3" })} />)

        // Should NOT show approve button
        await waitFor(() =>
            expect(screen.queryByRole("button", { name: /approve marketplace/i })).not.toBeInTheDocument()
        )

        // Should show list price input
        expect(await screen.findByLabelText(/asking price/i)).toBeInTheDocument()
    })
})

describe("TradeModal — accept (v3)", () => {
    it("(d) builds buildAcceptOfferV3Msg with (caller, collectionID, tokenId, buyerAddr)", async () => {
        const onSuccess = vi.fn()
        render(
            <TradeModal
                {...makeProps({ action: "accept", source: "v3", buyerAddr: BUYER_ADDR, onSuccess })}
            />,
        )

        const confirmBtn = await screen.findByRole("button", { name: /accept offer/i })
        fireEvent.click(confirmBtn)

        await waitFor(() => expect(mockDoContractBroadcast).toHaveBeenCalledOnce())

        expect(mockBuildAcceptOfferV3Msg).toHaveBeenCalledWith(
            CALLER,
            COLLECTION_ID,
            TOKEN_ID,
            BUYER_ADDR,
        )
        expect(onSuccess).toHaveBeenCalled()
    })
})

describe("TradeModal — cancel offer (v3)", () => {
    it("builds buildCancelOfferV3Msg with (caller, collectionID, tokenId) and reclaims", async () => {
        const onSuccess = vi.fn()
        render(
            <TradeModal {...makeProps({ action: "cancel", source: "v3", priceUgnot: PRICE_UGNOT, onSuccess })} />,
        )

        const confirmBtn = await screen.findByRole("button", { name: /reclaim/i })
        fireEvent.click(confirmBtn)

        await waitFor(() => expect(mockDoContractBroadcast).toHaveBeenCalledOnce())

        expect(mockBuildCancelOfferV3Msg).toHaveBeenCalledWith(CALLER, COLLECTION_ID, TOKEN_ID)
        expect(mockBuildAcceptOfferV3Msg).not.toHaveBeenCalled()
        expect(onSuccess).toHaveBeenCalled()
    })
})

describe("TradeModal — offer", () => {
    it("builds buildMakeOfferV3Msg when source=v3 and offer amount is entered", async () => {
        render(<TradeModal {...makeProps({ action: "offer", source: "v3" })} />)

        const input = screen.getByLabelText(/your offer/i)
        fireEvent.change(input, { target: { value: "1.5" } })

        const submitBtn = screen.getByRole("button", { name: /offer 1\.50 gnot/i })
        fireEvent.click(submitBtn)

        await waitFor(() => expect(mockDoContractBroadcast).toHaveBeenCalledOnce())

        expect(mockBuildMakeOfferV3Msg).toHaveBeenCalledWith(
            CALLER,
            COLLECTION_ID,
            TOKEN_ID,
            1_500_000, // 1.5 GNOT in ugnot
        )
    })

    it("shows escrow info text", () => {
        render(<TradeModal {...makeProps({ action: "offer", source: "v3" })} />)

        expect(screen.getByText(/escrow/i)).toBeInTheDocument()
        expect(screen.getByText(/7 day/i)).toBeInTheDocument()
    })
})

describe("TradeModal — buy, price unavailable", () => {
    it("shows alert and no confirm button when action=buy and priceUgnot is omitted", () => {
        render(
            <TradeModal
                {...makeProps({ action: "buy", source: "v3", priceUgnot: undefined })}
            />,
        )

        expect(screen.getByRole("alert")).toHaveTextContent(/price unavailable/i)
        expect(screen.queryByRole("button", { name: /confirm purchase/i })).not.toBeInTheDocument()
    })
})

describe("TradeModal — general", () => {
    it("calls onClose when Cancel is clicked", () => {
        const onClose = vi.fn()
        render(<TradeModal {...makeProps({ action: "buy", source: "v3", onClose })} />)

        fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
        expect(onClose).toHaveBeenCalled()
    })

    it("shows error on broadcast failure", async () => {
        mockDoContractBroadcast.mockRejectedValueOnce(new Error("wallet rejected"))
        render(<TradeModal {...makeProps({ action: "buy", source: "v3" })} />)

        fireEvent.click(screen.getByRole("button", { name: /confirm purchase/i }))

        await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
    })
})
