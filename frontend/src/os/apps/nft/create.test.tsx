import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NFT_DROPS_PATH } from "../../../lib/nft/drops"
import { ReadError } from "../../../lib/nft/read"
import { TokenLaunchpadReadError } from "../../../lib/tokenLaunchpadClient"
import NftWindow from "./native"

const realms = vi.hoisted(() => ({ drops: true }))
const mocks = vi.hoisted(() => ({ terms: vi.fn(), lane: vi.fn(), reserved: vi.fn(), unspendable: vi.fn(), price: vi.fn(), sign: vi.fn() }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isNftEnabled: () => true,
    isRealmValidOn: (_network: string, path: string) => (path === NFT_DROPS_PATH ? realms.drops : true),
}))
vi.mock("../../../lib/nft/drops", async (original) => ({ ...(await original<object>()), getDropTerms: mocks.terms }))
vi.mock("../../../lib/tokenLaunchpadConfigClient", async (original) => ({ ...(await original<object>()), readActionStatus: mocks.lane }))
vi.mock("../../../lib/nft/create", async (original) => ({ ...(await original<object>()), isReservedSymbol: mocks.reserved, isUnspendable: mocks.unspendable }))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<object>()), networkGasPriceFresh: mocks.price }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign: mocks.sign }) }))

const CREATOR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const A = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const BASE = `ipfs://bafy${"b".repeat(55)}/`
const network = { key: "testnet12", chainId: "test12" }
const member = { status: "member", address: CREATOR, network, openConnect: vi.fn() }
const guest = { status: "guest", network, openConnect: vi.fn() }
const open = { lane: "collection", currency: "ugnot", version: 1n, paused: false, allowlisted: true, laneReady: true, open: true }

function show(session: object = member) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
        <QueryClientProvider client={client}>
            <NftWindow section="create" session={session as never} active open={vi.fn()} push={vi.fn()} openApp={vi.fn()} close={() => {}} toast={() => {}} fallback={<p>classic page</p>} />
        </QueryClientProvider>,
    )
}
const type = (label: string, value: string) => fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } })
const fill = () => { type("Name", "Relevés"); type("Symbol", "rel"); type("Base URI", BASE) }

describe("Create a collection", () => {
    beforeEach(() => {
        realms.drops = true
        for (const mock of Object.values(mocks)) mock.mockReset()
        member.openConnect.mockReset()
        guest.openConnect.mockReset()
        mocks.terms.mockResolvedValue({ currency: "ugnot", collectionFee: 1_000_000n, primaryFeeBPS: 200n, maxPrimaryFeeBPS: 500n, treasury: A })
        mocks.lane.mockResolvedValue(open)
        mocks.reserved.mockResolvedValue(false)
        mocks.unspendable.mockResolvedValue(false)
        mocks.price.mockResolvedValue({ gas: 1000, ugnot: 1 })
    })

    it("shows the collection fee first, then reviews the terms typed, symbol in capitals", async () => {
        show()
        expect(await screen.findByText(/Creating a collection costs 1 GNOT, paid to the Launchpad treasury/)).toBeInTheDocument()
        fill()
        expect(screen.getByRole("textbox", { name: "Symbol" })).toHaveValue("REL")
        fireEvent.click(screen.getByRole("button", { name: "Review and create" }))
        await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        const args = mocks.sign.mock.calls[0][0].prepare().msgs[0].value.args
        expect(args).toEqual(["Relevés", "REL", "", "", "", "", "open", "false", "0", "static", BASE, "", "", "", "", "ugnot", "1000000"])
        expect(mocks.reserved).toHaveBeenCalledWith("REL")
    })

    it("says the first rule a term breaks, before reading anything", async () => {
        show()
        await screen.findByText(/Creating a collection costs/)
        type("Name", "Relevés")
        type("Symbol", "REL")
        fireEvent.click(screen.getByRole("button", { name: "Review and create" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("The base URI is an ipfs:// folder ending with /")
        type("Base URI", BASE)
        type("Maximum supply", "ten")
        fireEvent.click(screen.getByRole("button", { name: "Review and create" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("The maximum supply is a whole number")
        expect(mocks.lane).not.toHaveBeenCalled()
        expect(mocks.sign).not.toHaveBeenCalled()
    })

    it("sends royalties for a royalty-protected collection, and none once the mode is soulbound", async () => {
        show()
        await screen.findByText(/Creating a collection costs/)
        fill()
        fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), { target: { value: "royalty_protected" } })
        fireEvent.click(screen.getByRole("button", { name: "Add a royalty receiver" }))
        type("Royalty receiver 1", A)
        type("Royalty share 1 in percent", "2,5")
        fireEvent.click(screen.getByRole("button", { name: "Review and create" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("Write each royalty share as a percentage, such as 2.5.")
        type("Royalty share 1 in percent", "2.5")
        fireEvent.click(screen.getByRole("button", { name: "Review and create" }))
        await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        expect(mocks.sign.mock.calls[0][0].prepare().msgs[0].value.args.slice(6, 7).concat(mocks.sign.mock.calls[0][0].prepare().msgs[0].value.args[14])).toEqual(["royalty_protected", `${A}:250`])
        expect(mocks.unspendable).toHaveBeenCalledWith(A)

        fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), { target: { value: "soulbound" } })
        expect(screen.queryByRole("group", { name: "Royalties" })).toBeNull()
        fireEvent.click(screen.getByRole("checkbox", { name: "Revocable: I may revoke a token" }))
        fireEvent.click(screen.getByRole("button", { name: "Review and create" }))
        await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(2))
        const args = mocks.sign.mock.calls[1][0].prepare().msgs[0].value.args
        expect([args[6], args[7], args[14]]).toEqual(["soulbound", "true", ""])

        // Revocable belongs to soulbound tokens: a box ticked there is not sent for another mode.
        fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), { target: { value: "open" } })
        fireEvent.click(screen.getByRole("button", { name: "Review and create" }))
        await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(3))
        expect(mocks.sign.mock.calls[2][0].prepare().msgs[0].value.args.slice(6, 8)).toEqual(["open", "false"])
    })

    it("stops before the review when the symbol is reserved, the lane is paused or a read fails", async () => {
        show()
        await screen.findByText(/Creating a collection costs/)
        fill()
        const create = screen.getByRole("button", { name: "Review and create" })
        mocks.reserved.mockResolvedValueOnce(true)
        fireEvent.click(create)
        expect(await screen.findByRole("alert")).toHaveTextContent("The symbol REL is reserved on this network.")
        expect(mocks.lane).toHaveBeenCalledWith("testnet12", "collection", "ugnot")
        mocks.lane.mockResolvedValueOnce({ ...open, paused: true, open: false })
        fireEvent.click(create)
        await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Creating a collection is paused on this network for now."))
        mocks.lane.mockRejectedValueOnce(new TokenLaunchpadReadError("realm_error", "gno.land/r/samcrew/launchpad/config/v1 rejected the read"))
        fireEvent.click(create)
        await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The network refused to read the Launchpad config. Try again later."))
        mocks.price.mockRejectedValueOnce(new ReadError("offline"))
        fireEvent.click(create)
        await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The network could not be read. Try again in a moment."))
        expect(mocks.sign).not.toHaveBeenCalled()
    })

    it("lets a guest fill the form and asks it to connect only when it creates", async () => {
        show(guest)
        await screen.findByText(/Creating a collection costs/)
        fill()
        fireEvent.click(screen.getByRole("button", { name: "Connect to create" }))
        expect(guest.openConnect).toHaveBeenCalledOnce()
        expect(mocks.lane).not.toHaveBeenCalled()
    })

    it("says when creating in GNOT is not open, and offers no creation", async () => {
        mocks.terms.mockResolvedValue({ currency: "ugnot", collectionFee: null, primaryFeeBPS: null, maxPrimaryFeeBPS: 500n, treasury: "" })
        show()
        expect(await screen.findByText("Creating a collection in GNOT is not open on this network.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review and create" })).toBeDisabled()
    })
})
