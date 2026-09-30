import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NFT_CURATION_PATH } from "../../../lib/nft/curation"
import { NFT_DROPS_PATH } from "../../../lib/nft/drops"
import { getIpfsGatewayUrl } from "../../../lib/ipfs"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import NftWindow from "./native"

const realms = vi.hoisted(() => ({ drops: true, curation: true }))
const reads = vi.hoisted(() => ({
    getCollection: vi.fn(), getCapabilities: vi.fn(), listTokens: vi.fn(), listStages: vi.fn(), getCurationRecord: vi.fn(), fetchTokenMetadata: vi.fn(),
}))
vi.mock("../../../lib/nft/ledger", async (original) => ({ ...(await original<object>()), getCollection: reads.getCollection, getCapabilities: reads.getCapabilities, listTokens: reads.listTokens }))
vi.mock("../../../lib/nft/drops", async (original) => ({ ...(await original<object>()), listStages: reads.listStages }))
vi.mock("../../../lib/nft/curation", async (original) => ({ ...(await original<object>()), getCurationRecord: reads.getCurationRecord }))
vi.mock("../../../lib/nft/metadata", async (original) => ({ ...(await original<object>()), fetchTokenMetadata: reads.fetchTokenMetadata }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isNftEnabled: () => true,
    isRealmValidOn: (_network: string, path: string) => path === NFT_DROPS_PATH ? realms.drops : path === NFT_CURATION_PATH ? realms.curation : true,
}))

const CREATOR = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const FIRST = "g1e6gxg5tvc55mwsn7t7dymmlasratv7mkv0rap2"
const NEXT = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const MARKET = "g1mxl8rd36lgkxv855kcjdxn2s9jvtymjvplve5r"
const IMAGE = `ipfs://bafy${"i".repeat(55)}`
const ROOT = "ab".repeat(32)

const collection = {
    id: "C1", grc721Id: "C1", issuer: "g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj", creator: CREATOR, originator: FIRST, pendingCreator: NEXT,
    name: "Relevés", symbol: "REL", description: "Field drawings​", image: IMAGE, banner: "", website: "https://relev.es",
    mode: "royalty_protected", revocable: false, maxSupply: 100n, sealed: false, minted: 21n, totalSupply: 21n, profileFrozen: false,
    metadataMode: "mutable", metadataFrozen: false, metadataRevision: 2n, baseURI: IMAGE + "/", placeholderURI: "", baseURICommitment: "", committer: "",
    provenanceHash: "", traitsRoot: "", royaltyBPS: 500n, royalties: [{ account: CREATOR, bps: 300n }, { account: FIRST, bps: 200n }], markets: [MARKET],
}
const capabilities = {
    schema: "launchpad-nft-capabilities/v1", collection: "C1", standard: "grc721", mode: "royalty_protected", holderTransfer: false, marketSale: true,
    markets: [MARKET], holderBurn: true, creatorRevoke: false, maxSupply: 100n, metadataMode: "mutable", metadataFrozen: false, traitsCommitted: false,
    royaltyBPS: 500n, royaltyEnforcement: "listed_markets",
}
const curation = (marks: Partial<Record<"verified" | "featured" | "hidden", boolean>> = {}) => ({ collection: "C1", verified: false, featured: false, hidden: false, ...marks })
const stage = (index: number, kind: string, more: object = {}) => ({
    index, kind, start: 1_790_000_000n, end: 1_790_086_400n, open: false, price: 1_500_000n, floor: 0n, currentPrice: 1_500_000n, currency: "ugnot",
    feeBPS: 250n, supplyCap: 0n, perWallet: 2n, root: "", gate: "", minted: 0n, ...more,
})
const token = (number: number) => ({ collection: "C1", number: BigInt(number), owner: CREATOR, status: "active", uri: `${IMAGE}/${number}.json` })

function show(push = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
        <QueryClientProvider client={client}>
            <NftWindow section="c/C1" session={{ status: "guest", network: { key: "testnet12" } } as never} active open={vi.fn()} push={push} openApp={vi.fn()} close={() => {}} toast={() => {}} fallback={<p>classic page</p>} />
        </QueryClientProvider>,
    )
    return push
}
const pushed = (push: ReturnType<typeof vi.fn>) => push.mock.calls.map(([spec]) => `${spec.target.app}/${spec.target.section}`)

describe("NFT collection profile", () => {
    beforeEach(() => {
        realms.drops = true
        realms.curation = true
        for (const read of Object.values(reads)) read.mockReset()
        reads.getCollection.mockResolvedValue(collection)
        reads.getCapabilities.mockResolvedValue(capabilities)
        reads.getCurationRecord.mockResolvedValue(curation({ verified: true }))
        reads.listStages.mockResolvedValue([])
        reads.listTokens.mockResolvedValue([])
        reads.fetchTokenMetadata.mockResolvedValue({ name: "Relevé", description: null, image: null, attributes: [] })
    })

    it("shows the collection, its people and a way to trade it, for a guest", async () => {
        const push = show()
        expect(screen.getByRole("status")).toHaveTextContent("Reading the collection…")
        expect(await screen.findByRole("heading", { name: "Relevés" })).toBeInTheDocument()
        expect(screen.getByText("REL · C1")).toBeInTheDocument()
        expect(await screen.findByText("Field drawings[U+200B]")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "https://relev.es" })).toHaveAttribute("rel", "noopener noreferrer")
        for (const [label, account] of [["Creator", CREATOR], ["Created by", FIRST], ["Pending creator", NEXT]]) expect(screen.getByText(label).nextSibling).toHaveTextContent(account)
        expect(within(screen.getByRole("region", { name: "Curation" })).getByText("Verified")).toBeInTheDocument()
        expect(screen.queryByText("classic page")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Trade on Market" }))
        fireEvent.click(screen.getByRole("button", { name: /Collections/ }))
        expect(pushed(push)).toEqual(["market/nfts/c/C1", "nft/null"])
    })

    it("words the Passport as what the ledger enforces, and a listed market's payment as the creator's word", async () => {
        show()
        const passport = await screen.findByRole("region", { name: "Collection Passport" })
        expect(await within(passport).findByText("Holders cannot transfer tokens directly.")).toBeInTheDocument()
        expect(passport).toHaveTextContent(`Tokens move only through the 1 market the creator listed:${MARKET}`)
        expect(passport).toHaveTextContent(`A royalty of 5% is set, to:${CREATOR} · 3%${FIRST} · 2%That a listed market pays it is the creator's word: the ledger cannot check it.`)
        for (const line of ["A holder can burn their token.", "The creator cannot revoke tokens.", "At most 100 tokens can ever be minted (21 so far).",
            "The creator can still change token metadata (revision 2).", "No token traits are committed on chain."]) expect(within(passport).getByText(line)).toBeInTheDocument()
    })

    it("says an open collection's royalty does not bind a direct transfer", async () => {
        reads.getCollection.mockResolvedValue({ ...collection, mode: "open", markets: [], sealed: true, metadataMode: "static", metadataFrozen: true, metadataRevision: 0n })
        reads.getCapabilities.mockResolvedValue({ ...capabilities, mode: "open", holderTransfer: true, markets: [], royaltyEnforcement: "market_sales", metadataMode: "static", metadataFrozen: true })
        show()
        const passport = await screen.findByRole("region", { name: "Collection Passport" })
        expect(await within(passport).findByText("Holders can transfer their tokens directly.")).toBeInTheDocument()
        expect(passport).toHaveTextContent("A holder can approve any market to sell a token.")
        expect(passport).toHaveTextContent("The ledger states it for markets to pay on a sale. A direct transfer between holders pays none.")
        expect(passport).toHaveTextContent("Minting has ended for good, at 21 tokens.")
        expect(passport).toHaveTextContent("Token metadata is fixed on IPFS.")
    })

    it("collapses a hidden collection's presentation and token art until the viewer asks, and blocks nothing else", async () => {
        reads.getCurationRecord.mockResolvedValue(curation({ hidden: true }))
        reads.listTokens.mockResolvedValue([token(1)])
        const push = show()
        const note = await screen.findByText(/Curators have hidden this collection for now/)
        expect(note).toHaveTextContent("Its image, banner, description and token art are collapsed.")
        expect(screen.queryByText("Field drawings[U+200B]")).toBeNull()
        for (const image of document.querySelectorAll("img")) expect(image.getAttribute("src")).not.toContain(getIpfsGatewayUrl(`bafy${"i".repeat(55)}`))
        const card = await screen.findByRole("button", { name: "C1 #1" })
        expect(reads.fetchTokenMetadata).not.toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Trade on Market" })).toBeInTheDocument()
        fireEvent.click(card)
        expect(pushed(push)).toEqual(["nft/c/C1/1"])

        fireEvent.click(screen.getByRole("button", { name: "Show anyway" }))
        expect(screen.getByText("Field drawings[U+200B]")).toBeInTheDocument()
        expect(note).toHaveTextContent("You chose to show it.")
        expect(await screen.findByRole("button", { name: /Relevé.*C1 #1/ })).toBeInTheDocument()
        expect(reads.fetchTokenMetadata).toHaveBeenCalledWith(`${IMAGE}/1.json`, expect.anything())
    })

    it("keeps the presentation collapsed while curation cannot be read, with a retry and a way to show it", async () => {
        reads.getCurationRecord.mockRejectedValueOnce(new ReadError("Could not read curation record")).mockResolvedValueOnce(curation())
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("Curation could not be read.")
        expect(screen.queryByText("Field drawings[U+200B]")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("No curation mark.")).toBeInTheDocument()
        expect(screen.getByText("Field drawings[U+200B]")).toBeInTheDocument()
    })

    it("does not read curation or stages where their realms are not available", async () => {
        realms.curation = false
        realms.drops = false
        show()
        expect(await screen.findByText("Curation is not available on this network.")).toBeInTheDocument()
        expect(screen.getByText("Mint stages are not available on this network.")).toBeInTheDocument()
        expect(screen.getByText("Field drawings[U+200B]")).toBeInTheDocument()
        expect(reads.getCurationRecord).not.toHaveBeenCalled()
        expect(reads.listStages).not.toHaveBeenCalled()
    })

    it("lists mint stages read-only, with the fee split in words and no mint action", async () => {
        reads.listStages.mockResolvedValue([
            stage(0, "fixed", { supplyCap: 50n, minted: 12n }),
            stage(1, "dutch", { start: 1_790_100_000n, end: 1_790_200_000n, open: true, price: 10_000_000n, floor: 1_000_000n, currentPrice: 4_000_000n, feeBPS: 0n }),
            stage(2, "holder", { start: 1_790_300_000n, end: 1_790_400_000n, gate: "C2" }),
            stage(3, "allowlist", { start: 1_790_500_000n, end: 1_790_600_000n, perWallet: 0n, root: ROOT, currency: "gno.land/r/demo/foo20", price: 1500n }),
        ])
        const push = show()
        const stages = await screen.findByRole("region", { name: "Mint stages" })
        const [fixed, dutch, holder, allowlist] = await within(stages).findAllByRole("listitem")
        expect(fixed).toHaveTextContent("Stage 1 · Fixed priceEnded")
        expect(fixed).toHaveTextContent("Window2026-09-21 14:13 UTC to 2026-09-22 14:13 UTC")
        expect(fixed).toHaveTextContent("Price1.5 GNOT")
        expect(fixed).toHaveTextContent("Per wallet2Minted12 / 50")
        expect(fixed).toHaveTextContent("The treasury receives 2.5% of each mint, the creator the rest. This split is fixed for the stage.")
        expect(dutch).toHaveTextContent("Stage 2 · Dutch auctionOpen now")
        expect(dutch).toHaveTextContent("Price10 GNOT, falling to 1 GNOTPrice now4 GNOT")
        expect(dutch).toHaveTextContent("The creator receives the whole price.")
        expect(holder).toHaveTextContent("Minted0, no stage cap")
        expect(allowlist).toHaveTextContent("Price1,500 foo20Currencygno.land/r/demo/foo20Per walletEach allowed address has its own allowance")
        expect(allowlist).toHaveTextContent(`Allowlist root${ROOT.slice(0, 12)}…`)
        expect(stages).toHaveTextContent("Minting arrives in a later version of Memba OS.")
        expect(within(stages).queryByRole("button", { name: /mint/i })).toBeNull()
        fireEvent.click(within(holder).getByRole("button", { name: "C2" }))
        expect(pushed(push)).toEqual(["nft/c/C2"])
    })

    it("shows unreadable stages as an error and no stage as empty", async () => {
        reads.listStages.mockRejectedValueOnce(new ReadError("Could not read stages")).mockResolvedValueOnce([])
        show()
        const stages = await screen.findByRole("region", { name: "Mint stages" })
        expect(await within(stages).findByRole("alert")).toHaveTextContent("The mint stages could not be read from this network.")
        fireEvent.click(within(stages).getByRole("button", { name: "Retry" }))
        expect(await within(stages).findByText("This collection has no mint stage.")).toBeInTheDocument()
    })

    it("pages the token grid, keeping read tokens above a page that fails", async () => {
        reads.listTokens
            .mockResolvedValueOnce(Array.from({ length: 20 }, (_, n) => token(n + 1)))
            .mockRejectedValueOnce(new ReadError("Could not read tokens"))
            .mockResolvedValueOnce([{ ...token(21), owner: "", status: "burned" }])
        show()
        const tokens = await screen.findByRole("region", { name: "Tokens" })
        expect(await within(tokens).findAllByRole("button", { name: /C1 #/ })).toHaveLength(20)
        expect(reads.listTokens).toHaveBeenLastCalledWith("C1", 0, 20)
        fireEvent.click(within(tokens).getByRole("button", { name: "Load more" }))
        expect(await within(tokens).findByRole("alert")).toHaveTextContent("More tokens could not be read.")
        expect(within(tokens).getAllByRole("button", { name: /C1 #/ })).toHaveLength(20)
        fireEvent.click(within(tokens).getByRole("button", { name: "Retry" }))
        expect(await within(tokens).findByRole("button", { name: /C1 #21\s*Burned/ })).toBeInTheDocument()
        expect(reads.listTokens).toHaveBeenLastCalledWith("C1", 1, 20)
        expect(within(tokens).queryByRole("button", { name: "Load more" })).toBeNull()
    })

    it("shows an unreadable token list as an error and none as empty", async () => {
        reads.listTokens.mockRejectedValueOnce(new ReadError("Could not read tokens")).mockResolvedValueOnce([])
        show()
        const tokens = await screen.findByRole("region", { name: "Tokens" })
        expect(await within(tokens).findByRole("alert")).toHaveTextContent("The tokens could not be read from this network.")
        fireEvent.click(within(tokens).getByRole("button", { name: "Retry" }))
        expect(await within(tokens).findByText("No token has been minted yet.")).toBeInTheDocument()
    })

    it("shows an unreadable collection as an error with a retry, and nothing below it", async () => {
        reads.getCollection.mockRejectedValueOnce(new ReadError("Could not read collection")).mockResolvedValueOnce(collection)
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("The collection could not be read from this network.")
        expect(screen.queryByRole("region", { name: "Collection Passport" })).toBeNull()
        expect(reads.getCapabilities).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("heading", { name: "Relevés" })).toBeInTheDocument()
    })

    it("shows a collection the ledger refuses as missing, with no retry and nothing below it", async () => {
        reads.getCollection.mockRejectedValue(new RealmRefusedError("The realm refused to read collection"))
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("There is no collection C1 on this network.")
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
        expect(reads.getCapabilities).not.toHaveBeenCalled()
    })
})
