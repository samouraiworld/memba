import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock only isRealmValid (the engine-allowlist guard); keep the rest of config real.
vi.mock("../config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../config")>()),
    isRealmValid: vi.fn(() => true),
}))

import { routeTrade, buildNftApproval, type RouteParams } from "./router"
import * as config from "../config"
import { NFT_MARKETPLACE_V3_PATH, NFT_MARKET_V3_ADDR, NFT_COLLECTIONS_PATH } from "../nftConfig"
import type { UnifiedNft, UnifiedService } from "./types"

const CALLER = "g1buyer"

function nft(over: Partial<UnifiedNft> = {}): UnifiedNft {
    return {
        assetType: "nft",
        id: "creator/slug/7", // collectionID "creator/slug" (has a slash) + tokenId "7"
        title: "#7",
        verified: false,
        seller: "g1seller",
        feeBps: 200,
        source: "chain",
        engine: { path: NFT_MARKETPLACE_V3_PATH, addr: NFT_MARKET_V3_ADDR },
        price: { amount: 124_000_000n, denom: "ugnot" },
        royaltyBps: 500,
        actions: ["buy", "offer"],
        ...over,
    }
}

const route = (p: Partial<RouteParams> & Pick<RouteParams, "action">) =>
    routeTrade({ listing: nft(), caller: CALLER, ...p })

beforeEach(() => {
    vi.mocked(config.isRealmValid).mockReturnValue(true)
})

describe("routeTrade — NFT lane dispatch", () => {
    it("buy → BuyNFT with the price as send, split id into collection + token", () => {
        const [msg] = route({ action: "buy", amountUgnot: 124_000_000 })
        expect(msg.value.func).toBe("BuyNFT")
        expect(msg.value.pkg_path).toBe(NFT_MARKETPLACE_V3_PATH)
        expect(msg.value.args).toEqual(["creator/slug", "7"])
        expect(msg.value.send).toBe("124000000ugnot")
    })

    it("list → ListNFT with price arg, no send", () => {
        const [msg] = route({ action: "list", amountUgnot: 5_000_000 })
        expect(msg.value.func).toBe("ListNFT")
        expect(msg.value.args).toEqual(["creator/slug", "7", "5000000"])
        expect(msg.value.send).toBe("")
    })

    it("offer → MakeOffer with escrow send", () => {
        const [msg] = route({ action: "offer", amountUgnot: 2_000_000 })
        expect(msg.value.func).toBe("MakeOffer")
        expect(msg.value.send).toBe("2000000ugnot")
    })

    it("delist / cancel-offer → no-arg-amount actions", () => {
        expect(route({ action: "delist" })[0].value.func).toBe("DelistNFT")
        expect(route({ action: "cancel-offer" })[0].value.func).toBe("CancelOffer")
    })

    it("accept → AcceptOffer with the buyer address", () => {
        const [msg] = route({ action: "accept", buyerAddr: "g1bidder" })
        expect(msg.value.func).toBe("AcceptOffer")
        expect(msg.value.args).toEqual(["creator/slug", "7", "g1bidder"])
    })
})

describe("routeTrade — validation + safety", () => {
    it("blocks the build when the engine is not allowlisted on this network", () => {
        vi.mocked(config.isRealmValid).mockReturnValue(false)
        expect(() => route({ action: "buy", amountUgnot: 1_000_000 })).toThrow(/not available on this network/)
    })

    it("requires a positive amount for buy/list/offer", () => {
        expect(() => route({ action: "buy" })).toThrow(/positive amountUgnot/)
        expect(() => route({ action: "list", amountUgnot: 0 })).toThrow(/positive amountUgnot/)
        expect(() => route({ action: "offer", amountUgnot: -5 })).toThrow(/positive amountUgnot/)
    })

    it("requires buyerAddr for accept", () => {
        expect(() => route({ action: "accept" })).toThrow(/requires buyerAddr/)
    })

    it("rejects a malformed listing id", () => {
        expect(() => routeTrade({ listing: nft({ id: "no-token-id" }), action: "delist", caller: CALLER })).toThrow(
            /invalid nft listing id/,
        )
    })

    it("throws for a lane that is not wired yet", () => {
        const svc: UnifiedService = {
            assetType: "service",
            id: "svc-1",
            title: "Audit",
            verified: false,
            seller: "g1f",
            feeBps: 200,
            source: "backend",
            engine: { path: "gno.land/r/samcrew/escrow_v2", addr: "g1escrow" },
            milestones: [{ title: "m", amount: 1n }],
            actions: ["hire"],
        }
        // engine allowlisted, but the lane has no router yet
        expect(() => routeTrade({ listing: svc, action: "buy", caller: CALLER })).toThrow(/not wired yet/)
    })
})

describe("buildNftApproval", () => {
    it("approves the engine as operator on the registry (not the market)", () => {
        const msg = buildNftApproval(nft(), CALLER)
        expect(msg.value.func).toBe("SetApprovalForAll")
        expect(msg.value.pkg_path).toBe(NFT_COLLECTIONS_PATH)
        expect(msg.value.args).toEqual(["creator/slug", NFT_MARKET_V3_ADDR, "true"])
    })
})
