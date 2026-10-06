import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    available: vi.fn(() => true),
    getListing: vi.fn(),
    getTokenListing: vi.fn(),
    getToken: vi.fn(),
    getMarketTerms: vi.fn(),
    lane: vi.fn(),
    wallet: vi.fn(),
    readTx: vi.fn(),
    freshPrice: vi.fn(),
}))

vi.mock("../../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../../lib/config")>(),
    isNftEnabled: mocks.available,
    isRealmValidOn: mocks.available,
}))
vi.mock("../../../../lib/nft/market", async (importActual) => ({ ...await importActual<typeof import("../../../../lib/nft/market")>(), getListing: mocks.getListing, getTokenListing: mocks.getTokenListing, getMarketTerms: mocks.getMarketTerms }))
vi.mock("../../../../lib/nft/ledger", async (importActual) => ({ ...await importActual<typeof import("../../../../lib/nft/ledger")>(), getToken: mocks.getToken }))
vi.mock("../../../../lib/tokenLaunchpadConfigClient", async (importActual) => ({ ...await importActual<typeof import("../../../../lib/tokenLaunchpadConfigClient")>(), readActionStatus: mocks.lane }))
vi.mock("../../../../lib/grc20", async (importActual) => {
    const actual = await importActual<typeof import("../../../../lib/grc20")>()
    return {
        ...actual,
        freshFeeForGasWanted: async (gasWanted: number) => actual.feeForGasWanted(gasWanted, await mocks.freshPrice()),
        // Stand-in for the broadcaster's order: confirmation → beforeSign → wallet.
        doContractBroadcast: vi.fn(async (msgs: unknown, memo: string, opts: { beforeSign?: () => Promise<unknown> }) => {
            const { setTxConfirmationCallback } = await import("../../../../lib/grc20")
            const confirm = setTxConfirmationCallback(null) ?? (async () => true)
            setTxConfirmationCallback(confirm)
            if (!(await confirm(msgs as never, memo))) throw new Error("Transaction cancelled by user")
            await opts.beforeSign?.()
            return mocks.wallet()
        }),
    }
})
vi.mock("../../../../lib/rpcFallback", async (importActual) => ({
    ...await importActual<typeof import("../../../../lib/rpcFallback")>(),
    getRpcUrlsInOrder: () => ["https://rpc.test"],
    directRpcCall: (_url: string, method: string, params: Record<string, string>) => mocks.readTx(method, params),
}))
vi.mock("../../../../lib/dao/chainIdentity", () => ({ assertRpcChain: async () => {} }))

import { doContractBroadcast, setTxConfirmationCallback } from "../../../../lib/grc20"
import type { NftListing } from "../../../../lib/nft/market"
import { executeSignature } from "../../../sign/signer"
import { buyRequest, cancelListingRequest, listRequest, type ListDraft, type ListingDraft } from "./tradeRequest"

const HASH = "b".repeat(64)
const BUYER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const SELLER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const ROYALTY = "g1e6gxg5tvc55mwsn7t7dymmlasratv7mkv0rap2"
const listing: NftListing = {
    id: "L12", collection: "C1", number: 5n, seller: SELLER, price: 2_000_000n, currency: "ugnot", createdAt: 1n, expiresAt: 4_102_444_800n, feeBPS: 50n,
    buyable: true, split: { seller: 1_890_000n, fee: 10_000n, royalties: [{ account: ROYALTY, amount: 100_000n }] },
}
const draft = (more: Partial<ListingDraft> = {}): ListingDraft => ({ listing, caller: BUYER, networkKey: "mainnet", chainId: "gnoland-1", price: { gas: 1000, ugnot: 1 }, ...more })
const run = (request: ReturnType<typeof buyRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})
const open = { lane: "nft_market", currency: "ugnot", paused: false, allowlisted: true, laneReady: true, open: true }

beforeEach(() => {
    mocks.available.mockReset().mockReturnValue(true)
    mocks.getListing.mockReset().mockResolvedValue(listing)
    mocks.getTokenListing.mockReset().mockResolvedValue(null)
    mocks.getToken.mockReset().mockResolvedValue({ collection: "C1", number: 5n, owner: SELLER, status: "active", uri: "" })
    mocks.getMarketTerms.mockReset().mockResolvedValue({ feeBPS: 50n, maxFeeBPS: 200n, treasury: ROYALTY, split: listing.split })
    mocks.lane.mockReset().mockResolvedValue(open)
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("buying a listing", () => {
    it("reviews where the price goes, then sends exactly the reviewed purchase", async () => {
        const request = buyRequest(draft())
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Price", "2 GNOT"], ["To the seller", "1.89 GNOT"], ["Protocol fee (0.5%)", "0.01 GNOT"], [`Royalty to ${ROYALTY}`, "0.1 GNOT"],
            ["Network fee", "0.0732 GNOT"],
        ]))
        expect(await run(request)).toEqual({ outcome: "sent", hash: HASH, result: undefined })
        expect(vi.mocked(doContractBroadcast)).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Buy C1 #5", expect.objectContaining({ gasWanted: 61_000_000, gasFee: 73_200 }))
        expect(mocks.lane).toHaveBeenCalledWith("mainnet", "nft_market", "ugnot")
        expect(await request.verify!(undefined, HASH, undefined)).toBe(true)
    })

    it("refuses a draft Memba must not sign", () => {
        expect(() => buyRequest(draft({ caller: SELLER }))).toThrow("This is your listing.")
        expect(() => buyRequest(draft({ caller: "g1nope" }))).toThrow("Connect your wallet first.")
        mocks.available.mockReturnValue(false)
        expect(() => buyRequest(draft())).toThrow("The NFT market is not available on this network.")
    })

    it.each([
        ["the market was paused", () => mocks.lane.mockResolvedValue({ ...open, paused: true, open: false }), "Trading is paused on this network for now. Nothing was sent."],
        ["the listing closed", () => mocks.getListing.mockResolvedValue(null), "This listing has closed. Nothing was sent."],
        ["the price changed", () => mocks.getListing.mockResolvedValue({ ...listing, price: 2_000_001n }), "This listing changed after your review."],
        ["the token changed", () => mocks.getListing.mockResolvedValue({ ...listing, number: 6n }), "This listing changed after your review."],
        ["the fee changed", () => mocks.getListing.mockResolvedValue({ ...listing, feeBPS: 100n }), "This listing changed after your review."],
        ["the expiry changed", () => mocks.getListing.mockResolvedValue({ ...listing, expiresAt: listing.expiresAt + 1n }), "This listing changed after your review."],
        ["the royalties changed", () => mocks.getListing.mockResolvedValue({ ...listing, split: { ...listing.split, royalties: [{ account: SELLER, amount: 100_000n }] } }), "This listing changed after your review."],
        ["the seller changed", () => mocks.getListing.mockResolvedValue({ ...listing, seller: ROYALTY }), "This listing changed after your review."],
        // Each part of the split on its own: the readers check that the parts add up, this check does not rely on it.
        ["a royalty amount changed", () => mocks.getListing.mockResolvedValue({ ...listing, split: { ...listing.split, royalties: [{ account: ROYALTY, amount: 100_001n }] } }), "This listing changed after your review."],
        ["the seller's part changed", () => mocks.getListing.mockResolvedValue({ ...listing, split: { ...listing.split, seller: 1_890_001n } }), "This listing changed after your review."],
        ["it is no longer buyable", () => mocks.getListing.mockResolvedValue({ ...listing, buyable: false }), "This listing cannot be bought now. Nothing was sent."],
        ["the network fee rose", () => mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 }), "fee"],
    ])("stops before the wallet when %s", async (_, change, message) => {
        change()
        const result = await run(buyRequest(draft()))
        expect(result.outcome).toBe("failed")
        expect((result as { error: string }).error).toContain(message)
        expect(mocks.wallet).not.toHaveBeenCalled()
    })
})

describe("cancelling a listing", () => {
    it("sends the seller's cancel without asking the market lane", async () => {
        mocks.lane.mockResolvedValue({ ...open, paused: true, open: false })
        const request = cancelListingRequest(draft({ caller: SELLER }))
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ caller: SELLER, func: "Cancel", args: ["L12"], send: "" })
        expect(await run(request)).toMatchObject({ outcome: "sent", hash: HASH })
        expect(mocks.lane).not.toHaveBeenCalled()
        expect(vi.mocked(doContractBroadcast)).toHaveBeenCalledWith(expect.anything(), "Cancel listing L12", expect.objectContaining({ gasWanted: 26_000_000 }))
    })

    it("is the seller's alone, and stops when the listing already closed", async () => {
        expect(() => cancelListingRequest(draft())).toThrow("Only the seller")
        mocks.getListing.mockResolvedValueOnce(null)
        expect(await run(cancelListingRequest(draft({ caller: SELLER })))).toEqual({ outcome: "failed", error: "This listing has already closed. Nothing was sent." })
        mocks.getListing.mockResolvedValueOnce({ ...listing, seller: BUYER })
        expect(await run(cancelListingRequest(draft({ caller: SELLER })))).toEqual({ outcome: "failed", error: "Only the seller can cancel this listing now. Nothing was sent." })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })
})

describe("listing a token", () => {
    const listDraft = (more: Partial<ListDraft> = {}): ListDraft => ({
        collection: "C1", number: 5n, price: 2_000_000n, expiresAt: 4_102_444_800n, feeBPS: 50n, split: listing.split, replaces: null,
        caller: SELLER, networkKey: "mainnet", chainId: "gnoland-1", gas: { gas: 1000, ugnot: 1 }, ...more,
    })

    it("reviews the price, where it would go at a sale and the expiry, then sends the approval and the listing together", async () => {
        mocks.getTokenListing.mockResolvedValue({ ...listing, id: "L9" })
        const request = listRequest(listDraft({ replaces: "L9" }))
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Price", "2 GNOT"], ["At a sale: to the seller", "1.89 GNOT"], ["At a sale: protocol fee (0.5%)", "0.01 GNOT"],
            [`At a sale: royalty to ${ROYALTY}`, "0.1 GNOT"], ["Expires", "2100-01-01 00:00 UTC"], ["Replaces", "Listing L9, closed by this one"],
            ["Storage deposit", "Up to 1.86 GNOT; the listing's part (about 0.78 GNOT) goes to whoever closes it"],
        ]))
        const msgs = request.prepare(undefined).msgs
        expect(msgs.map((msg) => msg.value.func)).toEqual(["Approve", "List"])
        expect(msgs[1].value.args).toEqual(["C1", "5", "2000000", "4102444800", "ugnot", "50"])
        expect(await run(request)).toMatchObject({ outcome: "sent", hash: HASH })
        expect(vi.mocked(doContractBroadcast)).toHaveBeenCalledWith(msgs, "List C1 #5", expect.objectContaining({ gasWanted: 61_000_000 }))
        expect(mocks.getMarketTerms).toHaveBeenCalledWith("C1", 2_000_000n)
        expect(mocks.getTokenListing).toHaveBeenCalledWith("C1", 5n)
    })

    it.each([
        ["the expiry has passed", () => ({ expiresAt: BigInt(Math.floor(Date.now() / 1000)) }), () => {}, "expiry has passed"],
        ["the market was paused", () => ({}), () => mocks.lane.mockResolvedValue({ ...open, paused: true, open: false }), "Trading is paused on this network for now."],
        ["the token moved", () => ({}), () => mocks.getToken.mockResolvedValue({ collection: "C1", number: 5n, owner: BUYER, status: "active", uri: "" }), "no longer holds C1 #5"],
        ["the token was burned", () => ({}), () => mocks.getToken.mockResolvedValue({ collection: "C1", number: 5n, owner: SELLER, status: "burned", uri: "" }), "no longer holds C1 #5"],
        ["the protocol fee changed", () => ({}), () => mocks.getMarketTerms.mockResolvedValue({ feeBPS: 100n, maxFeeBPS: 200n, treasury: ROYALTY, split: { seller: 1_880_000n, fee: 20_000n, royalties: listing.split.royalties } }), "terms changed"],
        // At a tiny price both fees round to nothing and the split stays the same: the fee itself is compared.
        ["the protocol fee changed under an unchanged split", () => ({}), () => mocks.getMarketTerms.mockResolvedValue({ feeBPS: 60n, maxFeeBPS: 200n, treasury: ROYALTY, split: listing.split }), "terms changed"],
        ["the market stopped quoting", () => ({}), () => mocks.getMarketTerms.mockResolvedValue({ feeBPS: 50n, maxFeeBPS: 200n, treasury: ROYALTY, split: null }), "terms changed"],
        ["the royalties changed", () => ({}), () => mocks.getMarketTerms.mockResolvedValue({ feeBPS: 50n, maxFeeBPS: 200n, treasury: ROYALTY, split: { seller: 1_990_000n, fee: 10_000n, royalties: [] } }), "terms changed"],
        // The market keeps one listing per token and List closes it: the sheet must name the one the chain holds now.
        ["the listing it replaces closed", () => ({ replaces: "L9" }), () => mocks.getTokenListing.mockResolvedValue(null), "open listing of C1 #5 changed"],
        ["another listing took the place of the one it replaces", () => ({ replaces: "L9" }), () => mocks.getTokenListing.mockResolvedValue({ ...listing, id: "L10" }), "open listing of C1 #5 changed"],
        ["a listing appeared after the read", () => ({}), () => mocks.getTokenListing.mockResolvedValue({ ...listing, id: "L9" }), "open listing of C1 #5 changed"],
    ])("stops before the wallet when %s", async (_, more, change, message) => {
        change()
        const result = await run(listRequest(listDraft(more())))
        expect(result.outcome).toBe("failed")
        expect((result as { error: string }).error).toContain(message)
        expect(mocks.wallet).not.toHaveBeenCalled()
    })
})
