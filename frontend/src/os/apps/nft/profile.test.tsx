import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NFT_CURATION_PATH } from "../../../lib/nft/curation"
import { NFT_DROPS_PATH } from "../../../lib/nft/drops"
import { getIpfsGatewayUrl } from "../../../lib/ipfs"
import { derivePkgBech32Addr } from "../../../lib/dao/realmAddress"
import { NFT_MARKET_PATH } from "../../../lib/nft/market"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import { TokenLaunchpadReadError } from "../../../lib/tokenLaunchpadClient"
import NftWindow from "./native"

const realms = vi.hoisted(() => ({ drops: true, curation: true }))
const reads = vi.hoisted(() => ({
    getCollection: vi.fn(), getCapabilities: vi.fn(), listTokens: vi.fn(), listStages: vi.fn(), getCurationRecord: vi.fn(), fetchTokenMetadata: vi.fn(),
}))
vi.mock("../../../lib/nft/ledger", async (original) => ({ ...(await original<object>()), getCollection: reads.getCollection, getCapabilities: reads.getCapabilities, listTokens: reads.listTokens, getToken: (...args: unknown[]) => minting.getToken(...args) }))
const minting = vi.hoisted(() => ({
    sign: vi.fn(), mintedBy: vi.fn(), gateUsed: vi.fn(), getToken: vi.fn(), readActionStatus: vi.fn(), price: vi.fn(),
}))
vi.mock("../../../lib/nft/drops", async (original) => ({ ...(await original<object>()), listStages: reads.listStages, mintedBy: minting.mintedBy, gateUsed: minting.gateUsed }))
vi.mock("../../../lib/tokenLaunchpadConfigClient", async (original) => ({ ...(await original<object>()), readActionStatus: minting.readActionStatus }))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<object>()), networkGasPriceFresh: minting.price }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign: minting.sign }) }))
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
const LAUNCHPAD_MARKET = "g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3"
const ISSUER = "g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj"
const IMAGE = `ipfs://bafy${"i".repeat(55)}`
const ROOT = "ab".repeat(32)

const collection = {
    id: "C1", grc721Id: "C1", issuer: ISSUER, creator: CREATOR, originator: FIRST, pendingCreator: NEXT,
    name: "Relevés", symbol: "REL", description: "Field drawings​", image: IMAGE, banner: "", website: "https://relev.es",
    mode: "royalty_protected", revocable: false, maxSupply: 100n, sealed: false, minted: 21n, totalSupply: 21n, profileFrozen: false,
    metadataMode: "mutable", metadataFrozen: false, metadataRevision: 2n, baseURI: IMAGE + "/", placeholderURI: "", baseURICommitment: "", committer: "",
    provenanceHash: "", traitsRoot: "", royaltyBPS: 500n, royalties: [{ account: CREATOR, bps: 300n }, { account: FIRST, bps: 200n }], markets: [LAUNCHPAD_MARKET, MARKET],
}
const capabilities = {
    schema: "launchpad-nft-capabilities/v1", collection: "C1", standard: "grc721", mode: "royalty_protected", holderTransfer: false, marketSale: true,
    markets: [LAUNCHPAD_MARKET, MARKET], holderBurn: true, creatorRevoke: false, maxSupply: 100n, metadataMode: "mutable", metadataFrozen: false, traitsCommitted: false,
    royaltyBPS: 500n, royaltyEnforcement: "listed_markets",
}
const curation = (marks: Partial<Record<"verified" | "featured" | "hidden", boolean>> = {}) => ({ collection: "C1", verified: false, featured: false, hidden: false, ...marks })
const stage = (index: number, kind: string, more: object = {}) => ({
    index, kind, start: 1_790_000_000n, end: 1_790_086_400n, open: false, price: 1_500_000n, floor: 0n, currentPrice: 1_500_000n, currency: "ugnot",
    feeBPS: 250n, supplyCap: 0n, perWallet: 2n, root: "", gate: "", minted: 0n, ...more,
})
const token = (number: number) => ({ collection: "C1", number: BigInt(number), owner: CREATOR, status: "active", uri: `${IMAGE}/${number}.json` })

const MEMBER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const guest = { status: "guest", network: { key: "testnet12", chainId: "test12" }, openConnect: vi.fn() }
const member = { status: "member", address: MEMBER, network: { key: "testnet12", chainId: "test12" }, openConnect: vi.fn() }

function show(push = vi.fn(), session: object = guest) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
        <QueryClientProvider client={client}>
            <NftWindow section="c/C1" session={session as never} active open={vi.fn()} push={push} openApp={vi.fn()} close={() => {}} toast={() => {}} fallback={<p>classic page</p>} />
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
        for (const mock of Object.values(minting)) mock.mockReset()
        guest.openConnect.mockReset()
        minting.readActionStatus.mockResolvedValue({ lane: "nft_drops", currency: "ugnot", version: 1n, paused: false, allowlisted: true, laneReady: true, open: true })
        minting.mintedBy.mockResolvedValue(0n)
        minting.gateUsed.mockResolvedValue(false)
        minting.price.mockResolvedValue({ gas: 1000, ugnot: 1 })
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

    it("words the Passport as what the ledger enforces, and an added market's payment as the creator's word", async () => {
        show()
        const passport = await screen.findByRole("region", { name: "Collection Passport" })
        expect(await within(passport).findByText("Holders cannot transfer tokens directly.")).toBeInTheDocument()
        expect(passport).toHaveTextContent(
            `Tokens move only through these markets: the Launchpad market, plus any the creator adds (at most 5 in all).${LAUNCHPAD_MARKET} · the Launchpad market${MARKET}`)
        expect(passport).toHaveTextContent(`A royalty of 5% is set, to:${CREATOR} · 3%${FIRST} · 2%That a market the creator adds pays it is the creator's word: the ledger cannot check it.`)
        expect(passport).toHaveTextContent(`Only the issuer realm mints: ${ISSUER}. The creator can move minting to another allowed realm with SetIssuer.`)
        expect(passport).toHaveTextContent(`Token n's metadata file is ${IMAGE}/<n>.json.`)
        for (const line of ["A holder can burn their token.", "The creator cannot revoke tokens.", "At most 100 tokens can ever be minted (21 so far).",
            "The creator can still change token metadata (revision 2).", "No token traits are committed on chain."]) expect(within(passport).getByText(line)).toBeInTheDocument()
    })

    it("names the Launchpad market by the address its package path derives", async () => {
        expect(await derivePkgBech32Addr(NFT_MARKET_PATH)).toBe(LAUNCHPAD_MARKET)
    })

    it("says an uncapped supply ends only when the creator seals it, and a placeholder serves every token until the reveal", async () => {
        const placeholder = `ipfs://bafy${"p".repeat(55)}/hidden.json`
        reads.getCollection.mockResolvedValue({
            ...collection, maxSupply: 0n, metadataMode: "reveal", metadataRevision: 0n, baseURI: "", placeholderURI: placeholder,
            baseURICommitment: "cd".repeat(32), committer: CREATOR, provenanceHash: "ef".repeat(32),
        })
        reads.getCapabilities.mockResolvedValue({ ...capabilities, maxSupply: 0n, metadataMode: "reveal" })
        show()
        const passport = await screen.findByRole("region", { name: "Collection Passport" })
        expect(await within(passport).findByText("No supply cap: tokens can be minted until the creator seals the supply (21 so far).")).toBeInTheDocument()
        expect(passport).toHaveTextContent(`Until the reveal, every token's metadata file is ${placeholder}.`)
        expect(passport).toHaveTextContent("The creator can move minting to another allowed realm with SetIssuer.")
    })

    it("offers no way to Market for a soulbound collection, whose tokens are never sold", async () => {
        reads.getCollection.mockResolvedValue({ ...collection, mode: "soulbound", royaltyBPS: 0n, royalties: [], markets: [] })
        reads.getCapabilities.mockResolvedValue({ ...capabilities, mode: "soulbound", marketSale: false, markets: [], royaltyBPS: 0n, royaltyEnforcement: "none" })
        show()
        const passport = await screen.findByRole("region", { name: "Collection Passport" })
        expect(await within(passport).findByText("Tokens cannot be sold on a market.")).toBeInTheDocument()
        expect(screen.getByRole("heading", { name: "Relevés" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Trade on Market" })).toBeNull()
    })

    it("says an open collection's royalty does not bind a direct transfer", async () => {
        reads.getCollection.mockResolvedValue({ ...collection, mode: "open", markets: [], sealed: true, metadataMode: "static", metadataFrozen: true, metadataRevision: 0n })
        reads.getCapabilities.mockResolvedValue({ ...capabilities, mode: "open", holderTransfer: true, markets: [], royaltyEnforcement: "market_sales", metadataMode: "static", metadataFrozen: true })
        show()
        const passport = await screen.findByRole("region", { name: "Collection Passport" })
        expect(await within(passport).findByText("Holders can transfer their tokens directly.")).toBeInTheDocument()
        expect(passport).toHaveTextContent("A holder can approve any market to sell a token.")
        expect(passport).toHaveTextContent("Markets that honour royalties pay it on a sale; the ledger enforces nothing, and a direct transfer pays none.")
        expect(passport).toHaveTextContent("The supply is sealed: minting has ended for good, at 21 tokens.")
        expect(passport).not.toHaveTextContent("issuer")
        expect(passport).toHaveTextContent("Token metadata is fixed on IPFS.")
    })

    it("collapses a hidden collection's presentation and token art until the viewer asks, and blocks nothing else", async () => {
        reads.getCurationRecord.mockResolvedValue(curation({ hidden: true }))
        reads.listTokens.mockResolvedValue([token(1)])
        const push = show()
        const note = await screen.findByText(/Curators have hidden this collection for now/)
        expect(note).toHaveTextContent("Its image, banner, description, website and token art are collapsed.")
        expect(screen.queryByText("Field drawings[U+200B]")).toBeNull()
        expect(screen.queryByText(/relev\.es/)).toBeNull()
        for (const image of document.querySelectorAll("img")) expect(image.getAttribute("src")).not.toContain(getIpfsGatewayUrl(`bafy${"i".repeat(55)}`))
        const card = await screen.findByRole("button", { name: "C1 #1" })
        expect(reads.fetchTokenMetadata).not.toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Trade on Market" })).toBeInTheDocument()
        fireEvent.click(card)
        expect(pushed(push)).toEqual(["nft/c/C1/1"])

        fireEvent.click(screen.getByRole("button", { name: "Show anyway" }))
        expect(screen.getByText("Field drawings[U+200B]")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "https://relev.es" })).toBeInTheDocument()
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

    it("lists mint stages with the fee split in words, and a mint action only on an open stage Memba can mint in", async () => {
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
        expect(fixed).not.toHaveTextContent("Sold out")
        expect(dutch).toHaveTextContent("Stage 2 · Dutch auctionOpen now")
        expect(dutch).toHaveTextContent("Price10 GNOT, falling to 1 GNOTPrice now4 GNOT")
        expect(dutch).toHaveTextContent("The creator receives the whole price.")
        expect(holder).toHaveTextContent("Minted0, no stage capGateEach token of C2 allows one mint")
        expect(allowlist).toHaveTextContent("Price1,500 foo20Currencygno.land/r/demo/foo20Per walletEach allowed address has its own allowance")
        expect(within(allowlist).getByText(ROOT)).toBeVisible()
        for (const closed of [fixed, holder, allowlist]) expect(within(closed).queryByRole("button", { name: /mint/i })).toBeNull()
        fireEvent.click(within(holder).getByRole("button", { name: "C2" }))
        expect(pushed(push)).toEqual(["nft/c/C2"])
        // A guest reads every stage and is asked to connect only when minting.
        fireEvent.click(within(dutch).getByRole("button", { name: "Connect to mint" }))
        expect(guest.openConnect).toHaveBeenCalledOnce()
        expect(minting.mintedBy).not.toHaveBeenCalled()
        expect(minting.sign).not.toHaveBeenCalled()
    })

    it("says why an open stage cannot be minted in Memba yet", async () => {
        reads.listStages.mockResolvedValue([
            stage(0, "allowlist", { open: true, perWallet: 0n, root: ROOT }),
            stage(1, "fixed", { start: 1_790_100_000n, end: 1_790_200_000n, currency: "gno.land/r/demo/foo20" }),
            stage(2, "fixed", { start: 1_790_300_000n, end: 1_790_400_000n, open: true, supplyCap: 5n, minted: 5n }),
        ])
        show(vi.fn(), member)
        const [allowlist, token, soldOut] = await within(await screen.findByRole("region", { name: "Mint stages" })).findAllByRole("listitem")
        expect(allowlist).toHaveTextContent("Minting from an allowlist arrives in a later version of Memba OS.")
        expect(token).not.toHaveTextContent("Minting in a token")
        expect(soldOut).toHaveTextContent("This stage is sold out.")
        expect(screen.queryByRole("button", { name: /mint/i })).toBeNull()
    })

    it("offers no mint once the supply is sealed or full, and says why on the open stage", async () => {
        reads.listStages.mockResolvedValue([stage(0, "fixed", { open: true })])
        reads.getCollection.mockResolvedValue({ ...collection, sealed: true })
        show(vi.fn(), member)
        const [open] = await within(await screen.findByRole("region", { name: "Mint stages" })).findAllByRole("listitem")
        expect(open).toHaveTextContent("Minting has ended for good: the creator sealed the supply.")
        expect(screen.queryByRole("button", { name: /mint/i })).toBeNull()
    })

    it("keeps Mint off while a mint from the stage is on its way, and gives it back once its outcome is known", async () => {
        reads.listStages.mockResolvedValue([stage(0, "fixed", { open: true })])
        show(vi.fn(), member)
        fireEvent.click(await screen.findByRole("button", { name: "Mint" }))
        await vi.waitFor(() => expect(minting.sign).toHaveBeenCalledOnce())
        const request = minting.sign.mock.calls[0][0]
        // The member signs: the sheet sends, and the outcome is still to come.
        void request.send(undefined, async () => {}).catch(() => {})
        expect(await screen.findByRole("button", { name: "Minting…" })).toBeDisabled()
        act(() => request.onSettled("submitted"))
        expect(await screen.findByRole("button", { name: "Mint" })).toBeEnabled()
    })

    it("gives Mint back when the check at signing refuses and nothing is sent", async () => {
        reads.listStages.mockResolvedValue([stage(0, "fixed", { open: true })])
        show(vi.fn(), member)
        fireEvent.click(await screen.findByRole("button", { name: "Mint" }))
        await vi.waitFor(() => expect(minting.sign).toHaveBeenCalledOnce())
        const request = minting.sign.mock.calls[0][0]
        // The member signs: the sheet sends, then the lane closes and the recheck it runs before the wallet refuses.
        void request.send(undefined, async () => {}).catch(() => {})
        expect(await screen.findByRole("button", { name: "Minting…" })).toBeDisabled()
        minting.readActionStatus.mockResolvedValueOnce({ lane: "nft_drops", currency: "ugnot", version: 1n, paused: true, allowlisted: true, laneReady: true, open: false })
        await expect(request.recheck()).rejects.toThrow("Nothing was sent.")
        // The signer then reports nothing sent, and never settles a failed request.
        act(() => request.onNothingSent())
        expect(await screen.findByRole("button", { name: "Mint" })).toBeEnabled()
    })

    it("opens the review with the exact Mint call after reading the lane, the fee and the member's count", async () => {
        reads.listStages.mockResolvedValue([stage(0, "dutch", { open: true, price: 10_000_000n, floor: 1_000_000n, currentPrice: 4_000_000n })])
        minting.mintedBy.mockResolvedValue(1n)
        show(vi.fn(), member)
        fireEvent.click(await screen.findByRole("button", { name: "Mint" }))
        await vi.waitFor(() => expect(minting.sign).toHaveBeenCalledOnce())
        expect(minting.readActionStatus).toHaveBeenCalledWith("testnet12", "nft_drops", "ugnot")
        expect(minting.mintedBy).toHaveBeenCalledWith("C1", 0, MEMBER)
        const request = minting.sign.mock.calls[0][0]
        expect(request.prepare().msgs[0].value).toMatchObject({ caller: MEMBER, send: "4000000ugnot", func: "Mint", args: ["C1", "0", "ugnot", "4000000", "0", "", "0"] })
        expect(Object.fromEntries(request.lines())).toMatchObject({ "Collection": "Relevés (C1)", "Minted by you in this stage": "1 of 2" })
    })

    it("stops before the review when the lane is paused, the wallet limit is reached or a read fails", async () => {
        reads.listStages.mockResolvedValue([stage(0, "fixed", { open: true })])
        minting.readActionStatus.mockResolvedValueOnce({ lane: "nft_drops", currency: "ugnot", version: 1n, paused: true, allowlisted: true, laneReady: true, open: false })
        show(vi.fn(), member)
        const mint = await screen.findByRole("button", { name: "Mint" })
        fireEvent.click(mint)
        expect(await screen.findByRole("alert")).toHaveTextContent("Minting is paused on this network for now.")
        minting.mintedBy.mockResolvedValueOnce(2n)
        fireEvent.click(mint)
        await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This account has minted as many tokens as this stage allows per wallet."))
        minting.price.mockRejectedValueOnce(new ReadError("Could not read the gas price"))
        fireEvent.click(mint)
        await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The network could not be read. Try again in a moment."))
        // Each failed lane read differs from the one before it, so a stale alert never passes.
        for (const [code, said] of [
            ["realm_error", "The network refused to read the Launchpad config. Try again later."],
            ["rpc_error", "The network could not be read. Try again in a moment."],
            ["invalid_response", "What this network's Launchpad config sent does not follow its rules, so nothing was checked against it."],
            ["unavailable", "The Launchpad config cannot be read on this network."],
            ["network_changed", "The network changed during the check. Try again."],
        ] as const) {
            minting.readActionStatus.mockRejectedValueOnce(new TokenLaunchpadReadError(code, "gno.land/r/samcrew/launchpad/config/v1 rejected the read"))
            fireEvent.click(mint)
            await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(said))
        }
        expect(minting.sign).not.toHaveBeenCalled()
    })

    it("asks for a gate token the member holds and has not used in a holder stage", async () => {
        reads.listStages.mockResolvedValue([stage(0, "holder", { open: true, gate: "C2", price: 0n, currentPrice: 0n })])
        minting.getToken.mockResolvedValue({ collection: "C2", number: 7n, owner: CREATOR, status: "active", uri: "" })
        show(vi.fn(), member)
        const mint = await screen.findByRole("button", { name: "Mint" })
        fireEvent.click(mint)
        expect(await screen.findByRole("alert")).toHaveTextContent("Enter the number of the C2 token that allows this mint.")
        fireEvent.change(screen.getByRole("textbox", { name: "Number of the C2 token that allows this mint" }), { target: { value: "7" } })
        fireEvent.click(mint)
        await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This account does not hold C2 #7."))
        minting.getToken.mockResolvedValue({ collection: "C2", number: 7n, owner: MEMBER, status: "active", uri: "" })
        minting.gateUsed.mockResolvedValueOnce(true)
        fireEvent.click(mint)
        await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("C2 #7 has already been used for a mint in this stage."))
        fireEvent.click(mint)
        await vi.waitFor(() => expect(minting.sign).toHaveBeenCalledOnce())
        expect(minting.gateUsed).toHaveBeenLastCalledWith("C1", 0, 7n)
        expect(minting.sign.mock.calls[0][0].prepare().msgs[0].value).toMatchObject({ send: "", args: ["C1", "0", "ugnot", "0", "0", "", "7"] })
    })

    it("words an upcoming stage as still editable, a full stage as sold out, and a time past the year 9999 without failing", async () => {
        reads.listStages.mockResolvedValue([
            stage(0, "fixed", { supplyCap: 5n, minted: 5n }),
            stage(1, "fixed", { start: 4_000_000_000n, end: 4_000_086_400n }),
            stage(2, "fixed", { start: 9_000_000_000_000n, end: 9_000_000_086_400n }),
        ])
        show()
        const stages = await screen.findByRole("region", { name: "Mint stages" })
        const [full, upcoming, far] = await within(stages).findAllByRole("listitem")
        expect(full).toHaveTextContent("Stage 1 · Fixed priceEndedSold out")
        expect(full).toHaveTextContent("Minted5 / 5")
        expect(full).toHaveTextContent("This split is fixed for the stage.")
        expect(upcoming).toHaveTextContent("Stage 2 · Fixed priceUpcoming")
        expect(upcoming).toHaveTextContent("Window2096-10-02 07:06 UTC to 2096-10-03 07:06 UTC")
        expect(upcoming).toHaveTextContent("The creator can still change this stage, this split included, until it starts.")
        expect(upcoming).not.toHaveTextContent("fixed for the stage")
        expect(upcoming).not.toHaveTextContent("Sold out")
        expect(far).toHaveTextContent("Windowafter the year 9999 to after the year 9999")
        expect(screen.getByRole("heading", { name: "Relevés" })).toBeInTheDocument()
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
