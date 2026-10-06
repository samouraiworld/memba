import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    available: vi.fn(() => true),
    getListing: vi.fn(),
    getOffer: vi.fn(),
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
vi.mock("../../../../lib/nft/market", async (importActual) => ({ ...await importActual<typeof import("../../../../lib/nft/market")>(), getListing: mocks.getListing, getOffer: mocks.getOffer, getTokenListing: mocks.getTokenListing, getMarketTerms: mocks.getMarketTerms }))
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
import type { NftOffer } from "../../../../lib/nft/market"
import { executeSignature } from "../../../sign/signer"
import { acceptOfferRequest, cancelOfferRequest, makeOfferRequest, type AcceptDraft, type MakeOfferDraft } from "./offerRequest"

const HASH = "c".repeat(64)
const BUYER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const HOLDER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const ROYALTY = "g1e6gxg5tvc55mwsn7t7dymmlasratv7mkv0rap2"
const split = { seller: 2_835_000n, fee: 15_000n, royalties: [{ account: ROYALTY, amount: 150_000n }] }
const offer: NftOffer = {
    id: "O7", kind: "collection", collection: "C1", number: 0n, trait: "", buyer: BUYER, price: 3_000_000n, currency: "ugnot", createdAt: 1n,
    expiresAt: 4_102_444_800n, feeBPS: 50n, split,
}
const open = { lane: "nft_market", currency: "ugnot", paused: false, allowlisted: true, laneReady: true, open: true }
const common = { networkKey: "mainnet", chainId: "gnoland-1", gas: { gas: 1000, ugnot: 1 } }
const run = (request: ReturnType<typeof makeOfferRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})
const failed = async (request: ReturnType<typeof makeOfferRequest>, message: string) => {
    const result = await run(request)
    expect(result.outcome).toBe("failed")
    expect((result as { error: string }).error).toContain(message)
    expect(mocks.wallet).not.toHaveBeenCalled()
}

beforeEach(() => {
    mocks.available.mockReset().mockReturnValue(true)
    mocks.getOffer.mockReset().mockResolvedValue(offer)
    mocks.getTokenListing.mockReset().mockResolvedValue(null)
    mocks.getToken.mockReset().mockResolvedValue({ collection: "C1", number: 5n, owner: HOLDER, status: "active", uri: "" })
    mocks.getMarketTerms.mockReset().mockResolvedValue({ feeBPS: 50n, maxFeeBPS: 200n, treasury: ROYALTY, split })
    mocks.lane.mockReset().mockResolvedValue(open)
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("making an offer", () => {
    const draft = (more: Partial<MakeOfferDraft> = {}): MakeOfferDraft => ({
        kind: "token", collection: "C1", number: 5n, price: 3_000_000n, expiresAt: 4_102_444_800n, feeBPS: 50n, split, caller: BUYER, ...common, ...more,
    })

    it("reviews the escrow and where it would go if accepted, then sends exactly the reviewed offer", async () => {
        const request = makeOfferRequest(draft())
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["For", "C1 #5"], ["Price", "3 GNOT, held by the market until the offer closes"], ["If accepted: to the seller", "2.835 GNOT"],
            [`If accepted: royalty to ${ROYALTY}`, "0.15 GNOT"], ["Expires", "2100-01-01 00:00 UTC"], ["Network fee", "0.042 GNOT"],
        ]))
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ send: "3000000ugnot", func: "MakeOffer", args: ["token", "C1", "5", "", "3000000", "4102444800", "ugnot", "50"] })
        expect(await run(request)).toMatchObject({ outcome: "sent", hash: HASH })
        expect(mocks.getMarketTerms).toHaveBeenCalledWith("C1", 3_000_000n)
        expect(await request.verify!(undefined, HASH, undefined)).toBe(true)
    })

    it("does not read a token for a collection offer", async () => {
        const request = makeOfferRequest(draft({ kind: "collection", number: 0n }))
        expect(request.summary).toBe("Offer 3 GNOT for any token of C1")
        expect(await run(request)).toMatchObject({ outcome: "sent" })
        expect(mocks.getToken).not.toHaveBeenCalled()
    })

    it.each([
        ["the expiry has passed", { expiresAt: BigInt(Math.floor(Date.now() / 1000)) }, () => {}, "expiry has passed"],
        ["the market was paused", {}, () => mocks.lane.mockResolvedValue({ ...open, paused: true, open: false }), "Trading is paused"],
        ["the token was burned", {}, () => mocks.getToken.mockResolvedValue({ collection: "C1", number: 5n, owner: "", status: "burned", uri: "" }), "can no longer be bought"],
        ["the buyer now holds the token", {}, () => mocks.getToken.mockResolvedValue({ collection: "C1", number: 5n, owner: BUYER, status: "active", uri: "" }), "already holds C1 #5"],
        ["the fee changed", {}, () => mocks.getMarketTerms.mockResolvedValue({ feeBPS: 60n, maxFeeBPS: 200n, treasury: ROYALTY, split }), "terms changed"],
        ["the market stopped quoting", {}, () => mocks.getMarketTerms.mockResolvedValue({ feeBPS: 50n, maxFeeBPS: 200n, treasury: ROYALTY, split: null }), "terms changed"],
        ["the split changed", {}, () => mocks.getMarketTerms.mockResolvedValue({ feeBPS: 50n, maxFeeBPS: 200n, treasury: ROYALTY, split: { ...split, royalties: [] } }), "terms changed"],
        ["the network fee rose", {}, () => mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 }), "fee"],
    ])("stops before the wallet when %s", async (_, more, change, message) => {
        change()
        await failed(makeOfferRequest(draft(more)), message)
    })
})

describe("cancelling an offer", () => {
    it("returns the escrow to its buyer without asking the market lane", async () => {
        mocks.lane.mockResolvedValue({ ...open, paused: true, open: false })
        const request = cancelOfferRequest({ offer, caller: BUYER, ...common })
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ func: "CancelOffer", args: ["O7"], send: "" })
        expect(request.lines(undefined)).toContainEqual(["Comes back to you", "3 GNOT"])
        expect(await run(request)).toMatchObject({ outcome: "sent" })
        expect(mocks.lane).not.toHaveBeenCalled()
    })

    it("is the buyer's alone, and stops when the offer already closed", async () => {
        expect(() => cancelOfferRequest({ offer, caller: HOLDER, ...common })).toThrow("Only the buyer")
        mocks.getOffer.mockResolvedValueOnce(null)
        await failed(cancelOfferRequest({ offer, caller: BUYER, ...common }), "This offer has already closed.")
        mocks.getOffer.mockResolvedValueOnce({ ...offer, buyer: HOLDER })
        await failed(cancelOfferRequest({ offer, caller: BUYER, ...common }), "Only the buyer can cancel this offer.")
    })

    it("stops before the wallet when the network fee rose", async () => {
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 })
        await failed(cancelOfferRequest({ offer, caller: BUYER, ...common }), "fee")
    })
})

describe("accepting an offer", () => {
    const draft = (more: Partial<AcceptDraft> = {}): AcceptDraft => ({ offer, number: 5n, listing: null, caller: HOLDER, ...common, ...more })

    it("reviews the sale, then sends the approval and the acceptance together", async () => {
        mocks.getTokenListing.mockResolvedValue({ id: "L3" })
        const request = acceptOfferRequest(draft({ listing: "L3" }))
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Token", "C1 #5"], ["Price", "3 GNOT"], ["To the seller", "2.835 GNOT"], ["Buyer", BUYER], ["Listing", "L3 closes with this sale"],
        ]))
        const msgs = request.prepare(undefined).msgs
        expect(msgs.map((msg) => msg.value.func)).toEqual(["Approve", "AcceptOffer"])
        expect(await run(request)).toMatchObject({ outcome: "sent" })
        expect(vi.mocked(doContractBroadcast)).toHaveBeenCalledWith(msgs, "Sell C1 #5", expect.objectContaining({ gasWanted: 70_000_000 }))
        expect(mocks.getToken).toHaveBeenCalledWith("C1", 5n)
        expect(mocks.getTokenListing).toHaveBeenCalledWith("C1", 5n)
    })

    it.each([
        ["the market was paused", () => mocks.lane.mockResolvedValue({ ...open, paused: true, open: false }), "Trading is paused"],
        ["the offer closed", () => mocks.getOffer.mockResolvedValue(null), "This offer has closed."],
        ["the price changed", () => mocks.getOffer.mockResolvedValue({ ...offer, price: 2_999_999n }), "This offer changed"],
        ["the buyer changed", () => mocks.getOffer.mockResolvedValue({ ...offer, buyer: ROYALTY }), "This offer changed"],
        ["the kind changed", () => mocks.getOffer.mockResolvedValue({ ...offer, kind: "token" }), "This offer changed"],
        ["the token changed", () => mocks.getOffer.mockResolvedValue({ ...offer, number: 6n }), "This offer changed"],
        ["the collection changed", () => mocks.getOffer.mockResolvedValue({ ...offer, collection: "C2" }), "This offer changed"],
        ["the currency changed", () => mocks.getOffer.mockResolvedValue({ ...offer, currency: "gno.land/r/demo/foo20" }), "This offer changed"],
        ["the fee changed", () => mocks.getOffer.mockResolvedValue({ ...offer, feeBPS: 60n }), "This offer changed"],
        ["the expiry changed", () => mocks.getOffer.mockResolvedValue({ ...offer, expiresAt: offer.expiresAt - 1n }), "This offer changed"],
        ["the split changed", () => mocks.getOffer.mockResolvedValue({ ...offer, split: { ...split, seller: split.seller + 1n } }), "This offer changed"],
        ["the token moved", () => mocks.getToken.mockResolvedValue({ collection: "C1", number: 5n, owner: BUYER, status: "active", uri: "" }), "no longer holds C1 #5"],
        ["the token was revoked", () => mocks.getToken.mockResolvedValue({ collection: "C1", number: 5n, owner: HOLDER, status: "revoked", uri: "" }), "no longer holds C1 #5"],
        // The sale closes whichever listing the token has: the sheet must name the one the chain holds now.
        ["a listing appeared after the read", () => mocks.getTokenListing.mockResolvedValue({ id: "L9" }), "open listing of C1 #5 changed"],
    ])("stops before the wallet when %s", async (_, change, message) => {
        change()
        await failed(acceptOfferRequest(draft()), message)
    })

    it.each([
        ["closed", null],
        ["replaced", { id: "L4" }],
    ])("stops before the wallet when the listing the review names was %s", async (_, current) => {
        mocks.getTokenListing.mockResolvedValue(current)
        await failed(acceptOfferRequest(draft({ listing: "L3" })), "open listing of C1 #5 changed")
    })

    it("stops when the offer has expired", async () => {
        const expired = { ...offer, expiresAt: BigInt(Math.floor(Date.now() / 1000) - 10) }
        mocks.getOffer.mockResolvedValue(expired)
        await failed(acceptOfferRequest(draft({ offer: expired })), "This offer has expired or expires within a minute.")
        // Still open, but not for long enough to reach a block: the wallet would sign a transaction the chain refuses.
        const closing = { ...offer, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 5) }
        mocks.getOffer.mockResolvedValue(closing)
        await failed(acceptOfferRequest(draft({ offer: closing })), "This offer has expired or expires within a minute.")
    })

    it("stops before the wallet when the network fee rose", async () => {
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 })
        await failed(acceptOfferRequest(draft()), "fee")
    })

    it("refuses an offer the holder cannot accept in Memba", () => {
        expect(() => acceptOfferRequest(draft({ caller: BUYER }))).toThrow("This is your offer.")
        expect(() => acceptOfferRequest(draft({ offer: { ...offer, kind: "token", number: 6n } }))).toThrow("another token")
    })
})

describe.each([
    ["making an offer", () => makeOfferRequest({ kind: "token", collection: "C1", number: 5n, price: 3_000_000n, expiresAt: 4_102_444_800n, feeBPS: 50n, split, caller: BUYER, ...common })],
    ["cancelling an offer", () => cancelOfferRequest({ offer, caller: BUYER, ...common })],
    ["accepting an offer", () => acceptOfferRequest({ offer, number: 5n, listing: null, caller: HOLDER, ...common })],
])("%s where the market is not available", (_, build) => {
    it("builds no request", () => {
        mocks.available.mockReturnValue(false)
        expect(build).toThrow("The NFT market is not available on this network.")
    })

    it("stops before the wallet when the market became unavailable after the review opened", async () => {
        const request = build()
        mocks.available.mockReturnValue(false)
        await failed(request, "The NFT market is not available on this network.")
    })
})
