import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ReadError } from "../../../lib/nft/read"
import NftWindow from "./native"

const reads = vi.hoisted(() => ({ listHoldings: vi.fn(), fetchTokenMetadata: vi.fn() }))
vi.mock("../../../lib/nft/ledger", async (original) => ({ ...(await original<object>()), listHoldings: reads.listHoldings }))
vi.mock("../../../lib/nft/metadata", async (original) => ({ ...(await original<object>()), fetchTokenMetadata: reads.fetchTokenMetadata }))
vi.mock("../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../lib/config")>()), isNftEnabled: () => true, isRealmValidOn: () => true }))

const MEMBER = "g1den8gttgdakxgetjta047h6lta047h6l30gcaz"
const holding = (collection: string, number: number) => ({ collection, number: BigInt(number), uri: `ipfs://bafy${"h".repeat(55)}/${number}.json` })

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

    it("shows an unreadable wallet as an error, and an empty one as empty", async () => {
        reads.listHoldings.mockRejectedValueOnce(new ReadError("Could not read holdings")).mockResolvedValueOnce([])
        show("member")
        expect(await screen.findByRole("alert")).toHaveTextContent("The collectibles could not be read from this network.")
        expect(screen.queryByText("This account holds no collectible yet.")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("This account holds no collectible yet.")).toBeInTheDocument()
    })
})
