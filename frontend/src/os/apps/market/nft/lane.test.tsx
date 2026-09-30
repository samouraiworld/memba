import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NftListing, NftOffer, NftOfferKind } from "../../../../lib/nft/market"
import { ReadError, RealmRefusedError } from "../../../../lib/nft/read"
import type { MarketNftRoute } from "../../../nft/routes"
import type { WindowSpec } from "../../../shell/windows"
import NftLane from "./lane"

// Only the readers are stubbed: every screen reads through them, and they are tested on their own.
const market = vi.hoisted(() => ({
    listListings: vi.fn(), listOffers: vi.fn(), listCollectionListings: vi.fn(), listCollectionOffers: vi.fn(),
    listSellerListings: vi.fn(), listBuyerOffers: vi.fn(), getTokenListing: vi.fn(),
}))
const ledger = vi.hoisted(() => ({ getCollection: vi.fn(), getToken: vi.fn() }))
vi.mock("../../../../lib/nft/market", async (original) => ({ ...(await original<typeof import("../../../../lib/nft/market")>()), ...market }))
vi.mock("../../../../lib/nft/ledger", async (original) => ({ ...(await original<typeof import("../../../../lib/nft/ledger")>()), ...ledger }))

const ME = `g1${"m".repeat(38)}`
const SELLER = `g1${"s".repeat(38)}`
const ROYALTY = `g1${"r".repeat(38)}`
const FUTURE = 4102444800n // 2100-01-01
const PAST = 1000000000n // 2001-09-09
const split = { seller: 1_312_500n, fee: 37_500n, royalties: [{ account: ROYALTY, amount: 150_000n }] }

function listing(id: number, number: bigint, extra: Partial<NftListing> = {}): NftListing {
    return { id: `L${id}`, collection: "C1", number, seller: SELLER, price: 1_500_000n, currency: "ugnot", createdAt: 1_700_000_000n, expiresAt: FUTURE, feeBPS: 250n, buyable: true, split, ...extra }
}

function offer(id: number, kind: NftOfferKind, extra: Partial<NftOffer> = {}): NftOffer {
    return {
        id: `O${id}`, collection: "C1", kind, number: kind === "token" ? 2n : 0n, trait: kind === "trait" ? "Background=Blue" : "", buyer: ME,
        price: 1_000_000n, currency: "ugnot", createdAt: 1_700_000_000n, expiresAt: FUTURE, feeBPS: 250n, split: { seller: 975_000n, fee: 25_000n, royalties: [] }, ...extra,
    }
}

const sectionOf = (spec: WindowSpec) => (spec.target?.kind === "app" ? `${spec.target.app}:${spec.target.section}` : null)

function show(route: MarketNftRoute, address = "") {
    const open = vi.fn<(spec: WindowSpec) => void>()
    const push = vi.fn<(spec: WindowSpec) => void>()
    const openConnect = vi.fn()
    const session = { status: address ? "member" : "guest", address, openConnect, network: { key: "mainnet", chainId: "chain-a" } } as never
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><NftLane route={route} session={session} open={open} push={push} /></QueryClientProvider>)
    return { open, push, openConnect }
}

const region = (name: string) => within(screen.getByRole("region", { name }))

describe("Market NFT lane", () => {
    beforeEach(() => {
        for (const read of [...Object.values(market), ...Object.values(ledger)]) read.mockReset()
        ledger.getCollection.mockResolvedValue({ id: "C1", name: "Founders​" })
        // No metadata to fetch: every token shows its generated art.
        ledger.getToken.mockResolvedValue({ uri: "" })
    })

    describe("Explore", () => {
        it("shows each open listing with its collection, token, price, expiry and whether it can be bought now, and the open offers", async () => {
            market.listListings.mockResolvedValue([listing(3, 7n, { buyable: false }), listing(2, 5n, { currency: "gno.land/r/demo/foo20", price: 1500n })])
            market.listOffers.mockResolvedValue([offer(9, "trait", { expiresAt: PAST }), offer(8, "collection")])
            const { push } = show({ kind: "explore" })
            const listings = region("Open listings")
            expect(listings.getByText("Reading listings…")).toBeInTheDocument()
            const [first, second] = await listings.findAllByRole("button", { name: /Founders/ })
            expect(market.listListings).toHaveBeenCalledWith("", 20)
            // Creator text shows its invisible characters.
            expect(first).toHaveTextContent("Founders[U+200B] #7")
            expect(first).toHaveTextContent("1.5 GNOT")
            expect(first).toHaveTextContent("Expires 2100-01-01 00:00 UTC")
            expect(first).toHaveTextContent("Not buyable now")
            expect(second).toHaveTextContent("1,500 foo20gno.land/r/demo/foo20")
            expect(second).not.toHaveTextContent("Not buyable now")
            expect(listings.queryByRole("button", { name: /Load more/ })).toBeNull()

            const offers = region("Open offers")
            const [trait, whole] = await offers.findAllByRole("button")
            expect(trait).toHaveTextContent("Trait offer")
            expect(trait).toHaveTextContent("Tokens carrying Background=Blue")
            expect(trait).toHaveTextContent("Expired: waiting for its refund")
            expect(whole).toHaveTextContent("Collection offer Founders[U+200B]Any token of the collection1 GNOTExpires 2100-01-01 00:00 UTC")

            fireEvent.click(first)
            expect(sectionOf(push.mock.lastCall![0])).toBe("market:nfts/c/C1/7")
            fireEvent.click(whole)
            expect(sectionOf(push.mock.lastCall![0])).toBe("market:nfts/c/C1")
        })

        it("reads the next page from past the last listing while pages come back full, and keeps what it read when a page fails", async () => {
            const page = Array.from({ length: 20 }, (_, i) => listing(40 - i, BigInt(40 - i)))
            market.listListings.mockResolvedValueOnce(page).mockRejectedValueOnce(new ReadError("offline")).mockResolvedValueOnce([listing(20, 20n)])
            market.listOffers.mockResolvedValue([])
            show({ kind: "explore" })
            const listings = region("Open listings")
            fireEvent.click(await listings.findByRole("button", { name: "Load more listings" }))
            expect(market.listListings).toHaveBeenLastCalledWith("L21", 20)
            expect(await listings.findByRole("alert")).toHaveTextContent("More listings could not be read.")
            expect(listings.getAllByRole("button", { name: /Founders/ })).toHaveLength(20)

            fireEvent.click(listings.getByRole("button", { name: "Retry" }))
            expect(await listings.findByText("Founders[U+200B] #20")).toBeInTheDocument()
            expect(market.listListings).toHaveBeenLastCalledWith("L21", 20)
            expect(listings.getAllByRole("button", { name: /Founders/ })).toHaveLength(21)
            expect(listings.queryByRole("button", { name: /Load more/ })).toBeNull()
        })

        it("shows a failed read as an error with a retry, never as an empty market, and an empty one as empty", async () => {
            market.listListings.mockRejectedValueOnce(new ReadError("realm not found")).mockResolvedValue([])
            market.listOffers.mockResolvedValue([])
            show({ kind: "explore" })
            const listings = region("Open listings")
            expect(await listings.findByRole("alert")).toHaveTextContent("The listings could not be read from this network.")
            expect(listings.queryByText("No token is listed right now.")).toBeNull()
            expect(await region("Open offers").findByText("No offer is open right now.")).toBeInTheDocument()

            fireEvent.click(listings.getByRole("button", { name: "Retry" }))
            expect(await listings.findByText("No token is listed right now.")).toBeInTheDocument()
            // Guests browse: no wallet prompt outside My trading.
            expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull()
        })

        it("shows listings that break the realm's rules as unusable, on the first page and on the next, with no retry", async () => {
            market.listListings.mockRejectedValueOnce(new Error("Invalid listing"))
            market.listOffers.mockResolvedValueOnce(Array.from({ length: 20 }, (_, i) => offer(40 - i, "collection"))).mockRejectedValueOnce(new Error("Unordered offer list"))
            show({ kind: "explore" })
            const listings = region("Open listings")
            expect(await listings.findByRole("alert")).toHaveTextContent("What this network sent for the listings does not follow the realm's rules, so it is not shown.")
            expect(listings.queryByRole("button", { name: "Retry" })).toBeNull()
            const offers = region("Open offers")
            fireEvent.click(await offers.findByRole("button", { name: "Load more offers" }))
            expect(await offers.findByRole("alert")).toHaveTextContent("What this network sent for the next offers does not follow the realm's rules, so it is not shown.")
            expect(offers.queryByRole("button", { name: "Retry" })).toBeNull()
            expect(offers.getAllByText("Any token of the collection")).toHaveLength(20)
        })
    })

    describe("Collection", () => {
        it("lists the collection's listings in token order and its offers of every kind, labelled, and links to its profile", async () => {
            const page = Array.from({ length: 20 }, (_, i) => listing(100 - i, BigInt(i + 1)))
            market.listCollectionListings.mockResolvedValueOnce(page).mockResolvedValueOnce([])
            market.listCollectionOffers.mockResolvedValue([offer(1, "token"), offer(2, "collection"), offer(3, "trait")])
            const { open } = show({ kind: "collection", collection: "C1" })
            expect(await screen.findByRole("heading", { name: "Founders[U+200B]" })).toBeInTheDocument()
            expect(market.listCollectionListings).toHaveBeenCalledWith("C1", 0n, 20)
            expect(market.listCollectionOffers).toHaveBeenCalledWith("C1", "", 20)

            const listings = region("Listings in this collection")
            fireEvent.click(await listings.findByRole("button", { name: "Load more listings" }))
            expect(market.listCollectionListings).toHaveBeenLastCalledWith("C1", 20n, 20)
            await vi.waitFor(() => expect(listings.queryByRole("button", { name: /Load more/ })).toBeNull())
            expect(listings.getAllByRole("button", { name: /Founders/ })).toHaveLength(20)

            const offers = await region("Offers on this collection").findAllByRole("button")
            expect(offers.map((card) => within(card).getByText(/offer$/).textContent)).toEqual(["Token offer", "Collection offer", "Trait offer"])
            expect(offers[0]).toHaveTextContent("#2")

            fireEvent.click(screen.getByRole("button", { name: "Collection profile" }))
            expect(sectionOf(open.mock.lastCall![0])).toBe("nft:c/C1")
        })

        it("says when the collection itself cannot be read, and still shows its orders", async () => {
            ledger.getCollection.mockRejectedValue(new ReadError("offline"))
            market.listCollectionListings.mockResolvedValue([])
            market.listCollectionOffers.mockResolvedValue([])
            show({ kind: "collection", collection: "C1" })
            expect(await screen.findByText("The collection could not be read from this network.")).toBeInTheDocument()
            expect(screen.getByRole("heading", { name: "C1" })).toBeInTheDocument()
            expect(await screen.findByText("No token of this collection is listed.")).toBeInTheDocument()
        })

        it("says a collection the ledger refuses does not exist, with no retry", async () => {
            ledger.getCollection.mockRejectedValue(new RealmRefusedError("The realm refused to read collection"))
            market.listCollectionListings.mockResolvedValue([])
            market.listCollectionOffers.mockResolvedValue([])
            show({ kind: "collection", collection: "C1" })
            expect(await screen.findByRole("alert")).toHaveTextContent("There is no collection C1 on this network.")
            expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
        })
    })

    describe("Item", () => {
        it("shows the token's listing with the full split, the offers that apply to it, the closing rule, and links to its page", async () => {
            market.getTokenListing.mockResolvedValue(listing(4, 2n, { buyable: false }))
            market.listCollectionOffers.mockResolvedValue([offer(1, "token"), offer(2, "token", { number: 3n }), offer(3, "collection"), offer(4, "trait")])
            const { open } = show({ kind: "token", collection: "C1", number: 2n })
            expect(screen.getByText("Reading the listing…")).toBeInTheDocument()
            const panel = region("Listing")
            expect(await panel.findByText("Not buyable now")).toBeInTheDocument()
            expect(market.getTokenListing).toHaveBeenCalledWith("C1", 2n)
            expect(panel.getByText("1.5 GNOT")).toBeInTheDocument()
            expect(panel.getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
                `Seller${SELLER}1.3125 GNOT`, "Protocol fee (2.5%)Treasury0.0375 GNOT", `Royalty${ROYALTY}0.15 GNOT`,
            ])

            const offers = region("Offers for this token")
            await offers.findByText("Token offer")
            // The token offer for #3 does not apply; nothing here opens another view.
            expect(offers.queryByText("#3")).toBeNull()
            expect(offers.getByText("#2")).toBeInTheDocument()
            expect(offers.getByText("Any token of the collection")).toBeInTheDocument()
            expect(offers.getByText("If this token carries Background=Blue")).toBeInTheDocument()
            expect(offers.queryAllByRole("button")).toEqual([])

            expect(screen.getByRole("note")).toHaveTextContent("storage deposit of about 0.47 GNOT, paid to whoever closes it: the buyer at a sale")
            expect(screen.getByRole("note")).toHaveTextContent("For a week after an order expires only its owner can close it")
            fireEvent.click(screen.getByRole("button", { name: "Item page" }))
            expect(sectionOf(open.mock.lastCall![0])).toBe("nft:c/C1/2")
        })

        it("says when the token is not listed, and when its listing cannot be read", async () => {
            market.getTokenListing.mockResolvedValueOnce(null)
            market.listCollectionOffers.mockResolvedValue([])
            show({ kind: "token", collection: "C1", number: 2n })
            expect(await screen.findByText("This token is not listed.")).toBeInTheDocument()
            expect(await screen.findByText("No offer applies to this token.")).toBeInTheDocument()
        })

        it("shows an unreadable listing as an error with a retry", async () => {
            market.getTokenListing.mockRejectedValueOnce(new ReadError("offline")).mockResolvedValueOnce(listing(4, 2n))
            market.listCollectionOffers.mockResolvedValue([])
            show({ kind: "token", collection: "C1", number: 2n })
            const panel = region("Listing")
            expect(await panel.findByRole("alert")).toHaveTextContent("The listing could not be read from this network.")
            expect(panel.queryByText("This token is not listed.")).toBeNull()
            fireEvent.click(panel.getByRole("button", { name: "Retry" }))
            expect(await panel.findByText("Buyable now")).toBeInTheDocument()
        })

        it("shows a listing the market refuses to read as refused, with no retry that could only be refused again", async () => {
            market.getTokenListing.mockRejectedValue(new RealmRefusedError("The realm refused to read listing"))
            market.listCollectionOffers.mockResolvedValue([])
            show({ kind: "token", collection: "C1", number: 2n })
            const panel = region("Listing")
            expect(await panel.findByRole("alert")).toHaveTextContent("This network's realm refused to read the listing.")
            expect(panel.queryByRole("button", { name: "Retry" })).toBeNull()
            expect(panel.queryByText("This token is not listed.")).toBeNull()
        })

        it("keeps reading while every offer read so far is for other tokens", async () => {
            const others = Array.from({ length: 20 }, (_, i) => offer(i + 1, "token", { number: 9n }))
            market.getTokenListing.mockResolvedValue(null)
            market.listCollectionOffers.mockResolvedValueOnce(others).mockResolvedValueOnce([offer(21, "collection")])
            show({ kind: "token", collection: "C1", number: 2n })
            const offers = region("Offers for this token")
            expect(await offers.findByText("None among the offers read so far.")).toBeInTheDocument()
            fireEvent.click(offers.getByRole("button", { name: "Load more offers" }))
            expect(await offers.findByText("Any token of the collection")).toBeInTheDocument()
            expect(market.listCollectionOffers).toHaveBeenLastCalledWith("C1", "O20", 20)
        })
    })

    describe("My trading", () => {
        it("asks a guest to connect, here only, and reads nothing", () => {
            const { openConnect } = show({ kind: "mine" })
            fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }))
            expect(openConnect).toHaveBeenCalled()
            expect(market.listSellerListings).not.toHaveBeenCalled()
            expect(market.listBuyerOffers).not.toHaveBeenCalled()
        })

        it("lists the account's open listings and offers, marking the expired ones as the account's to close", async () => {
            market.listSellerListings.mockResolvedValue([listing(1, 4n, { seller: ME, expiresAt: PAST, buyable: false }), listing(2, 5n, { seller: ME })])
            market.listBuyerOffers.mockResolvedValue([offer(3, "collection", { expiresAt: PAST })])
            show({ kind: "mine" }, ME)
            const [stale, fresh] = await region("My listings").findAllByRole("button", { name: /Founders/ })
            expect(market.listSellerListings).toHaveBeenCalledWith(ME, "", 20)
            expect(market.listBuyerOffers).toHaveBeenCalledWith(ME, "", 20)
            expect(stale).toHaveTextContent("Expired 2001-09-09 01:46 UTC")
            expect(stale).toHaveTextContent("Expired: yours to close")
            expect(fresh).not.toHaveTextContent("Expired")
            expect(await region("My offers").findByText("Expired: yours to close")).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull()
        })

        it("shows a failed read of the account's orders as an error", async () => {
            market.listSellerListings.mockRejectedValue(new ReadError("offline"))
            market.listBuyerOffers.mockResolvedValue([])
            show({ kind: "mine" }, ME)
            expect(await region("My listings").findByRole("alert")).toHaveTextContent("The listings could not be read from this network.")
            expect(await region("My offers").findByText("You have no open offer.")).toBeInTheDocument()
        })
    })

    it("switches between Explore and My trading as links", () => {
        market.listCollectionListings.mockResolvedValue([])
        market.listCollectionOffers.mockResolvedValue([])
        const { push } = show({ kind: "collection", collection: "C1" })
        expect(screen.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true")
        fireEvent.click(screen.getByRole("button", { name: "My trading" }))
        expect(sectionOf(push.mock.lastCall![0])).toBe("market:nfts/mine")
    })
})
