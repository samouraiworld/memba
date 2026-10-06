import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ReadError } from "../../../lib/nft/read"
import NftWindow from "./native"

const reads = vi.hoisted(() => ({ listHoldings: vi.fn(), fetchTokenMetadata: vi.fn(), getCurationRecord: vi.fn() }))
vi.mock("../../../lib/nft/ledger", async (original) => ({ ...(await original<object>()), listHoldings: reads.listHoldings }))
vi.mock("../../../lib/nft/curation", async (original) => ({ ...(await original<object>()), getCurationRecord: reads.getCurationRecord }))
vi.mock("../../../lib/nft/metadata", async (original) => ({ ...(await original<object>()), fetchTokenMetadata: reads.fetchTokenMetadata }))
vi.mock("../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../lib/config")>()), isNftEnabled: () => true, isRealmValidOn: () => true }))

const MEMBER = "g1den8gttgdakxgetjta047h6lta047h6l30gcaz"
const holding = (collection: string, number: number) => ({ collection, number: BigInt(number), uri: `ipfs://bafy${collection.toLowerCase()}${"h".repeat(53)}/${number}.json` })

function show(status: "guest" | "member" | "resuming") {
    const push = vi.fn()
    const openConnect = vi.fn()
    const session = { status, address: status === "member" ? MEMBER : "", network: { key: "testnet12" }, openConnect } as never
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
        <QueryClientProvider client={client}>
            <NftWindow section="mine" session={session} active open={vi.fn()} push={push} openApp={vi.fn()} close={() => {}} toast={() => {}} fallback={<p>classic page</p>} />
        </QueryClientProvider>,
    )
    return { push, openConnect }
}

describe("NFT My collectibles", () => {
    beforeEach(() => {
        reads.listHoldings.mockReset()
        reads.fetchTokenMetadata.mockReset().mockResolvedValue({ name: null, description: null, image: null, attributes: [] })
        reads.getCurationRecord.mockReset().mockImplementation(async (collection: string) => ({ collection, verified: false, featured: false, hidden: false }))
    })

    it("asks a guest to connect, without reading the chain", () => {
        const { openConnect } = show("guest")
        expect(screen.getByText("Connect a wallet to see the collectibles it holds.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Connect" }))
        expect(openConnect).toHaveBeenCalled()
        expect(reads.listHoldings).not.toHaveBeenCalled()
        expect(screen.queryByText("classic page")).toBeNull()
    })

    it("waits for a session being restored instead of asking to connect", () => {
        show("resuming")
        expect(screen.getByRole("status")).toHaveTextContent("Restoring your session…")
        expect(screen.queryByRole("button", { name: "Connect" })).toBeNull()
    })

    it("lists the connected account's holdings, page by page, each opening its item", async () => {
        reads.listHoldings
            .mockResolvedValueOnce([...Array.from({ length: 19 }, (_, n) => holding("C1", n + 1)), holding("C3", 1)])
            .mockResolvedValueOnce([holding("C4", 2)])
        const { push } = show("member")
        expect(screen.getByRole("status")).toHaveTextContent("Reading collectibles…")
        expect(await screen.findAllByRole("button", { name: /^C\d #\d+$/ })).toHaveLength(20)
        expect(reads.listHoldings).toHaveBeenCalledWith(MEMBER, 0, 20)
        fireEvent.click(screen.getByRole("button", { name: "Load more" }))
        fireEvent.click(await screen.findByRole("button", { name: "C4 #2" }))
        expect(reads.listHoldings).toHaveBeenLastCalledWith(MEMBER, 1, 20)
        expect(push.mock.calls.map(([spec]) => spec.target.section)).toEqual(["c/C4/2"])
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
    })

    it("keeps a hidden collection's art collapsed, and any collection's until its curation is read, reading each record once", async () => {
        let release!: () => void
        const held = new Promise<void>((done) => { release = done })
        reads.getCurationRecord.mockImplementation(async (collection: string) => {
            if (collection === "C3") await held
            return { collection, verified: false, featured: false, hidden: collection === "C1" }
        })
        reads.fetchTokenMetadata.mockImplementation(async (uri: string) => ({ name: `Art ${uri.slice(11, 13)}`, description: null, image: null, attributes: [] }))
        reads.listHoldings.mockResolvedValueOnce([holding("C1", 1), holding("C1", 2), holding("C3", 1), holding("C3", 2), holding("C4", 1)])
        show("member")
        expect(await screen.findByRole("button", { name: /Art c4/ })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "C1 #1" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "C3 #1" })).toBeInTheDocument()
        expect(reads.fetchTokenMetadata.mock.calls.map(([uri]) => uri.slice(11, 13))).toEqual(["c4"])

        await act(async () => release())
        await waitFor(() => expect(screen.getAllByRole("button", { name: /Art c3/ })).toHaveLength(2))
        expect(screen.getByRole("button", { name: "C1 #2" })).toBeInTheDocument()
        expect(reads.fetchTokenMetadata.mock.calls.map(([uri]) => uri.slice(11, 13)).sort()).toEqual(["c3", "c3", "c4"])
        expect(reads.getCurationRecord.mock.calls.map(([collection]) => collection)).toEqual(["C1", "C3", "C4"])
    })

    it("shows an unreadable wallet as an error, and an empty one as empty", async () => {
        reads.listHoldings.mockRejectedValueOnce(new ReadError("Could not read holdings")).mockResolvedValueOnce([])
        show("member")
        expect(await screen.findByRole("alert")).toHaveTextContent("The collectibles could not be read from this network.")
        expect(screen.queryByText("This account holds no collectible yet.")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("This account holds no collectible yet.")).toBeInTheDocument()
    })
})
