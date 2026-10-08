import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Code, ConnectError } from "@connectrpc/connect"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DailyTop } from "./DailyTop"

// A plain function wraps the board call: a rejecting vi.fn leaves its own settled-result promise unhandled.
const board = vi.hoisted(() => ({ call: (): Promise<unknown> => Promise.resolve({ entries: [] }), calls: [] as [string, number][] }))
vi.mock("../../../lib/gameApi", () => ({ gameApi: { getDailyLeaderboard: (date: string, limit: number) => { board.calls.push([date, limit]); return board.call() } } }))

// The component retries once itself (its own option beats the client default), after a one-second delay.
const slow = { timeout: 4000 }
const wrap = (onOpen = () => {}) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DailyTop chainId="gnoland-1" onOpen={onOpen} />
    </QueryClientProvider>)

describe("DailyTop", () => {
    beforeEach(() => { board.calls.length = 0 })

    it("loads, then lists the top three", async () => {
        let resolve!: (value: unknown) => void
        board.call = () => new Promise((done) => { resolve = done })
        wrap()
        expect(screen.getByText("Loading today's board…")).toBeInTheDocument()
        resolve({ entries: [1, 2, 3].map((rank) => ({ rank, address: `g1${String(rank).repeat(38)}`, score: rank * 100 })) })
        expect(await screen.findAllByRole("listitem")).toHaveLength(3)
        expect(board.calls[0]).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 3])
    })

    it("says an empty board is empty", async () => {
        board.call = async () => ({ entries: [] })
        wrap()
        expect(await screen.findByText("No finished runs today yet.")).toBeInTheDocument()
    })

    it("says a failed load is not an empty board", async () => {
        board.call = async () => { throw new ConnectError("down", Code.Unavailable) }
        wrap()
        expect(await screen.findByRole("status", {}, slow)).toHaveTextContent(/could not be loaded.*not an empty board/)
    })

    it("says so when the daily feature is paused", async () => {
        board.call = async () => { throw new ConnectError("paused", Code.Unimplemented) }
        wrap()
        expect(await screen.findByRole("status", {}, slow)).toHaveTextContent("The daily board isn't live right now.")
        expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
    })

    it("opens the full board in the game", async () => {
        board.call = async () => ({ entries: [] })
        const onOpen = vi.fn()
        wrap(onOpen)
        await screen.findByText("No finished runs today yet.")
        fireEvent.click(screen.getByRole("button", { name: "Full board in the game" }))
        expect(onOpen).toHaveBeenCalled()
    })
})
