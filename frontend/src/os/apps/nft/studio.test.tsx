import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NftStage } from "../../../lib/nft/drops"
import { TokenLaunchpadReadError } from "../../../lib/tokenLaunchpadClient"
import NftWindow from "./native"

const mocks = vi.hoisted(() => ({
    count: vi.fn(), page: vi.fn(), collection: vi.fn(), stages: vi.fn(), terms: vi.fn(), lane: vi.fn(), price: vi.fn(), sign: vi.fn(),
}))
vi.mock("../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../lib/config")>()), isNftEnabled: () => true, isRealmValidOn: () => true }))
vi.mock("../../../lib/nft/ledger", async (original) => ({ ...(await original<object>()), countCollections: mocks.count, listCollectionsPage: mocks.page, getCollection: mocks.collection }))
vi.mock("../../../lib/nft/drops", async (original) => ({ ...(await original<object>()), listStages: mocks.stages, getDropTerms: mocks.terms }))
vi.mock("../../../lib/tokenLaunchpadConfigClient", async (original) => ({ ...(await original<object>()), readActionStatus: mocks.lane }))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<object>()), networkGasPriceFresh: mocks.price }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign: mocks.sign }) }))

const CREATOR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const OTHER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const network = { key: "testnet12", chainId: "test12" }
const member = (address = CREATOR) => ({ status: "member", address, network, openConnect: vi.fn() })
const open = { lane: "nft_drops", currency: "ugnot", version: 1n, paused: false, allowlisted: true, laneReady: true, open: true }
const summary = (n: number, creator: string) => ({ id: `C${n}`, creator, name: `Name ${n}`, symbol: "S", image: "", mode: "open", maxSupply: 0n, sealed: false, minted: 3n })
const stage = (index: number, more: Partial<NftStage> = {}): NftStage => ({
    index, kind: "fixed", start: 1_700_000_000n, end: 1_700_086_400n, open: false, price: 1n, floor: 0n, currentPrice: 1n, currency: "ugnot", feeBPS: 200n,
    supplyCap: 0n, perWallet: 1n, root: "", gate: "", minted: 0n, ...more,
})

function show(section: string, session: object) {
    const push = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
        <QueryClientProvider client={client}>
            <NftWindow section={section} session={session as never} active open={vi.fn()} push={push} openApp={vi.fn()} close={() => {}} toast={() => {}} fallback={<p>classic page</p>} />
        </QueryClientProvider>,
    )
    return push
}
/** A datetime-local value `hours` from now, in local time. */
const local = (hours: number) => {
    const d = new Date(Date.now() + hours * 3_600_000)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

describe("Creator studio", () => {
    beforeEach(() => {
        for (const mock of Object.values(mocks)) mock.mockReset()
        mocks.collection.mockResolvedValue({ id: "C7", name: "Relevés", creator: CREATOR })
        mocks.stages.mockResolvedValue([])
        mocks.terms.mockResolvedValue({ currency: "ugnot", collectionFee: 1n, primaryFeeBPS: 200n, maxPrimaryFeeBPS: 500n, treasury: OTHER })
        mocks.lane.mockResolvedValue(open)
        mocks.price.mockResolvedValue({ gas: 1000, ugnot: 1 })
    })

    it("lists the account's collections newest first, searching older pages on request", async () => {
        mocks.count.mockResolvedValue(60n)
        mocks.page.mockImplementation(async (page: bigint) => page === 1n
            ? Array.from({ length: 10 }, (_, i) => summary(51 + i, i % 3 === 0 ? CREATOR : OTHER))
            : Array.from({ length: 50 }, (_, i) => summary(1 + i, i === 4 ? CREATOR : OTHER)))
        const push = show("studio", member())
        const grid = await screen.findAllByRole("button", { name: /^Name \d+/ })
        expect(grid.map((card) => card.textContent?.split(" · ")[0].replace("S", ""))).toEqual(["Name 60", "Name 57", "Name 54", "Name 51"])
        expect(mocks.page).toHaveBeenCalledWith(1n, 50)
        expect(screen.getByText("The newest 10 of 60 collections were searched.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Search older collections" }))
        expect(await screen.findByRole("button", { name: /^Name 5S/ })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Search older collections" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: /^Name 60/ }))
        expect(push.mock.lastCall![0].target.section).toBe("studio/C60")
    })

    it("asks a guest to connect, and says when the account created nothing", async () => {
        show("studio", { status: "guest", network, openConnect: vi.fn() })
        expect(screen.getByText("Connect a wallet to manage the collections it created.")).toBeInTheDocument()
        expect(mocks.count).not.toHaveBeenCalled()
    })

    it("says an account created nothing on an empty ledger", async () => {
        mocks.count.mockResolvedValue(0n)
        show("studio", member())
        expect(await screen.findByText("This account has created no collection yet.")).toBeInTheDocument()
        expect(mocks.page).not.toHaveBeenCalled()
    })

    it("shows a collection's stages to anyone and keeps scheduling to its creator", async () => {
        mocks.stages.mockResolvedValue([stage(0, { open: true })])
        show("studio/C7", member(OTHER))
        expect(await screen.findByText("Only the collection's creator schedules and ends its stages.")).toBeInTheDocument()
        expect(await screen.findByText(/Stage 1 · fixed · open now/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "End this stage now" })).toBeNull()
        expect(screen.queryByRole("region", { name: "Schedule a stage" })).toBeNull()
    })

    it("shows a guest the creator's controls and asks it to connect at the review", async () => {
        mocks.stages.mockResolvedValue([stage(0, { open: true })])
        const guest = { status: "guest", network, openConnect: vi.fn() }
        show("studio/C7", guest)
        expect(await screen.findByText("Connect as the collection's creator to schedule or end its stages.")).toBeInTheDocument()
        expect(screen.queryByText("Only the collection's creator schedules and ends its stages.")).toBeNull()
        expect(await screen.findByRole("region", { name: "Schedule a stage" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "End this stage now" }))
        expect(guest.openConnect).toHaveBeenCalledOnce()
        expect(mocks.sign).not.toHaveBeenCalled()
    })

    it("lets the creator schedule a stage after reading the lane and the fee", async () => {
        show("studio/C7", member())
        const form = within(await screen.findByRole("region", { name: "Schedule a stage" }))
        fireEvent.click(form.getByRole("button", { name: "Review the stage" }))
        expect(await form.findByRole("alert")).toHaveTextContent("Choose when the stage starts and ends.")
        fireEvent.change(form.getByLabelText("Starts"), { target: { value: local(2) } })
        fireEvent.change(form.getByLabelText("Ends"), { target: { value: local(26) } })
        fireEvent.change(form.getByRole("combobox", { name: "Kind" }), { target: { value: "dutch" } })
        fireEvent.change(form.getByRole("textbox", { name: "Starting price in GNOT" }), { target: { value: "10" } })
        fireEvent.change(form.getByRole("textbox", { name: "Floor price in GNOT" }), { target: { value: "10" } })
        fireEvent.click(form.getByRole("button", { name: "Review the stage" }))
        expect(await form.findByRole("alert")).toHaveTextContent("A dutch stage falls to a floor below its starting price.")
        fireEvent.change(form.getByRole("textbox", { name: "Floor price in GNOT" }), { target: { value: "" } })
        fireEvent.change(form.getByRole("textbox", { name: "Per wallet" }), { target: { value: "3" } })
        fireEvent.click(form.getByRole("button", { name: "Review the stage" }))
        await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        const args = mocks.sign.mock.calls[0][0].prepare().msgs[0].value.args
        expect([args[0], args[1], args[4], args[5], args[6], args[7], args[9], args[11]]).toEqual(["C7", "dutch", "10000000", "0", "0", "3", "", "200"])
        expect(Number(args[3]) - Number(args[2])).toBe(24 * 3600)
        expect(mocks.lane).toHaveBeenCalledWith("testnet12", "nft_drops", "ugnot")
    })

    it("stops before the review while new stages are not open", async () => {
        mocks.terms.mockResolvedValue({ currency: "ugnot", collectionFee: 1n, primaryFeeBPS: null, maxPrimaryFeeBPS: 500n, treasury: "" })
        show("studio/C7", member())
        const form = within(await screen.findByRole("region", { name: "Schedule a stage" }))
        fireEvent.change(form.getByLabelText("Starts"), { target: { value: local(2) } })
        fireEvent.change(form.getByLabelText("Ends"), { target: { value: local(3) } })
        fireEvent.click(form.getByRole("button", { name: "Review the stage" }))
        expect(await form.findByRole("alert")).toHaveTextContent("New stages are not open on this network: the protocol fee is not set.")
        mocks.lane.mockResolvedValueOnce({ ...open, paused: true, open: false })
        fireEvent.click(form.getByRole("button", { name: "Review the stage" }))
        await vi.waitFor(() => expect(form.getByRole("alert")).toHaveTextContent("Minting is paused on this network for now."))
        mocks.lane.mockRejectedValueOnce(new TokenLaunchpadReadError("invalid_response", "Launchpad config response: invalid version"))
        fireEvent.click(form.getByRole("button", { name: "Review the stage" }))
        await vi.waitFor(() => expect(form.getByRole("alert")).toHaveTextContent("What this network's Launchpad config sent does not follow its rules, so nothing was checked against it."))
        expect(mocks.sign).not.toHaveBeenCalled()
    })

    it("lets the creator end an open stage, and offers no new stage once ten are used", async () => {
        mocks.stages.mockResolvedValue(Array.from({ length: 10 }, (_, i) => stage(i, { open: i === 9 })))
        show("studio/C7", member())
        fireEvent.click(await screen.findByRole("button", { name: "End this stage now" }))
        await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        expect(mocks.sign.mock.calls[0][0].prepare().msgs[0].value).toMatchObject({ func: "EndStage", args: ["C7", "9"] })
        expect(screen.getByText("This collection has used its 10 stages.")).toBeInTheDocument()
        expect(screen.queryByRole("region", { name: "Schedule a stage" })).toBeNull()
    })
})
