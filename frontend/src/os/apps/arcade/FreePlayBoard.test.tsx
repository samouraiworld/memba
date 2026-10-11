import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FREE_PLAY_REALM, type FreePlayBoard as Board, type FreePlayBoardQuery, type FreePlayReceipt } from "../../../lib/arcadeFreePlay"
import { FreePlayBoard } from "./FreePlayBoard"

const target = { chainId: "gnoland-1", realm: FREE_PLAY_REALM }
const scope = { target, game: "space-invaders", rules: "signal-defense", simVersion: 1 } as const
const receipt = (n = 1): FreePlayReceipt => ({
    target, schemaVersion: 2, height: 123, attester: `g1${"a".repeat(38)}`, txHash: "e".repeat(64),
    entry: { game: scope.game, rules: scope.rules, simVersion: 1, player: `g1${String(n).padStart(38, "0")}`, runID: String(n).padStart(64, "0"), seed: "42", score: 9876, stateHash: "b".repeat(8), replayHash: "c".repeat(64) },
})
const board = (entries: FreePlayReceipt[] = []): Board => ({ ...scope, entries })
const deferred = () => { let resolve!: (value: Board) => void; const promise = new Promise<Board>(done => { resolve = done }); return { promise, resolve } }

describe("Free play leaderboard", () => {
    it("loads public scores and exposes the complete anchoring receipt", async () => {
        const response = deferred()
        const client = { board: vi.fn(() => response.promise) }
        render(<FreePlayBoard {...scope} client={client} />)
        expect(screen.getByRole("status")).toHaveTextContent("Loading anchored scores")
        expect(client.board).toHaveBeenCalledWith({ game: scope.game, rules: scope.rules, simVersion: 1, offset: 0, limit: 20 }, expect.any(AbortSignal))
        await act(async () => response.resolve(board([receipt()])))
        const row = screen.getByRole("listitem")
        expect(within(row).getByText(receipt().entry.player)).toBeVisible()
        expect(within(row).getByLabelText("Score 9876")).toBeVisible()
        const proof = within(row).getByLabelText(`Anchoring proof for ${receipt().entry.player}`)
        fireEvent.click(proof)
        expect(within(row).getByText(receipt().entry.runID)).toBeVisible()
        expect(within(row).getByText(FREE_PLAY_REALM)).toBeVisible()
        expect(within(row).getByText("123")).toBeVisible()
        expect(within(row).getByText(receipt().txHash!)).toBeVisible()
        expect(screen.queryByRole("button", { name: /connect|publish/i })).not.toBeInTheDocument()
    })

    it("distinguishes empty, unavailable and unconfigured readers", async () => {
        const { rerender } = render(<FreePlayBoard {...scope} client={{ board: async () => board() }} />)
        expect(await screen.findByText("No anchored scores yet for these rules.")).toBeVisible()
        rerender(<FreePlayBoard {...scope} client={{ board: async () => { throw new Error("offline") } }} />)
        expect(screen.queryByText("No anchored scores yet for these rules.")).not.toBeInTheDocument()
        expect(await screen.findByText(/leaderboard is unavailable/)).toBeVisible()
        rerender(<FreePlayBoard {...scope} client={null} />)
        expect(screen.getByText(/leaderboard is unavailable/)).toBeVisible()
        expect(screen.queryByRole("button", { name: "Refresh scores" })).not.toBeInTheDocument()
    })

    it("rejects a valid response for another injected target", async () => {
        render(<FreePlayBoard {...scope} target={{ ...target, chainId: "onyx" }} client={{ board: async () => board([receipt()]) }} />)
        expect(await screen.findByText(/leaderboard is unavailable/)).toBeVisible()
        expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
    })

    it.each([
        { game: "barricade" as const }, { rules: "other-rules" }, { simVersion: 2 }, { target: { ...target, chainId: "onyx" } },
    ])("aborts and ignores responses from a replaced context %j", async change => {
        const old = deferred(), current = deferred()
        const client = { board: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise) }
        const { rerender, unmount } = render(<FreePlayBoard {...scope} client={client} />)
        const oldSignal: AbortSignal = client.board.mock.calls[0][1]
        const next = { ...scope, ...change }
        rerender(<FreePlayBoard {...next} client={client} />)
        expect(oldSignal.aborted).toBe(true)
        await act(async () => old.resolve(board([receipt()])))
        expect(screen.getByRole("status")).toHaveTextContent("Loading anchored scores")
        expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
        await act(async () => current.resolve({ ...next, entries: [] }))
        expect(screen.getByText("No anchored scores yet for these rules.")).toBeVisible()
        const signal: AbortSignal = client.board.mock.calls[1][1]
        unmount()
        expect(signal.aborted).toBe(true)
    })

    it.each(["another reader", "null"] as const)("does not reuse resolved rows after reader A → %s → A", middle => {
        // The first A result is already committed; aborting callbacks cannot
        // invalidate it when exactly the same reader instance returns.
        return (async () => {
            const reload = deferred()
            const readerA = { board: vi.fn().mockResolvedValueOnce(board([receipt()])).mockReturnValueOnce(reload.promise) }
            const readerB = middle === "null" ? null : { board: vi.fn(() => new Promise<Board>(() => {})) }
            const view = render(<FreePlayBoard {...scope} client={readerA} />)
            expect(await screen.findByLabelText("Score 9876")).toBeVisible()
            view.rerender(<FreePlayBoard {...scope} client={readerB} />)
            expect(screen.queryByLabelText("Score 9876")).not.toBeInTheDocument()
            view.rerender(<FreePlayBoard {...scope} client={readerA} />)
            expect(screen.queryByLabelText("Score 9876")).not.toBeInTheDocument()
            expect(screen.getByRole("status")).toHaveTextContent("Loading anchored scores")
            expect(screen.getByRole("region", { name: "Free play leaderboard" })).toHaveAttribute("aria-busy", "true")
            await act(async () => reload.resolve(board()))
            expect(screen.getByText("No anchored scores yet for these rules.")).toBeVisible()
        })()
    })

    it("does not resurrect an old response after A → B → A", async () => {
        const first = deferred(), last = deferred()
        const client = { board: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ...board(), rules: "other" }).mockReturnValueOnce(last.promise) }
        const { rerender } = render(<FreePlayBoard {...scope} client={client} />)
        rerender(<FreePlayBoard {...scope} rules="other" client={client} />)
        rerender(<FreePlayBoard {...scope} client={client} />)
        await act(async () => last.resolve(board()))
        await act(async () => first.resolve(board([receipt()])))
        expect(screen.getByText("No anchored scores yet for these rules.")).toBeVisible()
        expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
    })

    it("replaces the reader without showing its stale rows or requesting authentication", async () => {
        const oldClient = { board: async () => board([receipt()]) }
        const response = deferred(), newClient = { board: () => response.promise }
        const { rerender } = render(<FreePlayBoard {...scope} client={oldClient} />)
        await screen.findByRole("listitem")
        rerender(<FreePlayBoard {...scope} client={newClient} />)
        expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
        expect(screen.getByRole("status")).toHaveTextContent("Loading")
        await act(async () => response.resolve(board()))
    })

    it("paginates only on demand, stops on an empty page, and resets for new rules", async () => {
        const client = { board: vi.fn(async (query: FreePlayBoardQuery) => ({ ...scope, ...query, entries: query.offset === 0 ? Array.from({ length: 20 }, (_, i) => receipt(i + 1)) : [] })) }
        const { rerender } = render(<FreePlayBoard {...scope} client={client} />)
        await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(20))
        expect(client.board).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
        fireEvent.click(screen.getByRole("button", { name: "Next page" }))
        expect(await screen.findByText("No more anchored scores on this page.")).toBeVisible()
        expect(client.board.mock.calls[1][0]).toMatchObject({ offset: 20, limit: 20 })
        expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
        expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled()
        rerender(<FreePlayBoard {...scope} rules="other" client={client} />)
        await waitFor(() => expect(client.board).toHaveBeenCalledTimes(3))
        expect(client.board.mock.calls[2][0]).toMatchObject({ offset: 0, rules: "other" })
        expect(screen.getByText("Page 1")).toBeVisible()
    })

    it.each(["block-party", "space-invaders", "barricade"] as const)("keeps %s isolated", async game => {
        const client = { board: vi.fn(async () => ({ ...board(), game })) }
        render(<FreePlayBoard {...scope} game={game} client={client} />)
        await screen.findByText("No anchored scores yet for these rules.")
        expect(client.board.mock.calls).toHaveLength(1)
    })
})
