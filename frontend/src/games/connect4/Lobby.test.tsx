import { fireEvent, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import type { Game } from "../../lib/connect4"

const lib = vi.hoisted(() => ({ getActive: vi.fn(), offer: vi.fn(), accept: vi.fn(), cancel: vi.fn(), getGame: vi.fn() }))
vi.mock("../../lib/connect4", async (orig) => ({ ...(await orig<typeof import("../../lib/connect4")>()), ...lib }))

import { Lobby } from "./Lobby"

const base: Game = {
    id: 1, creator: "g1alice", opponent: "", acceptor: "", stake: 2_000_000, fee: 100_000, expiresAt: 2_000,
    commitment: "c".repeat(64), board: "0".repeat(42), turn: 0, turnPlayer: "", moves: 0, lastCol: 0, lastRow: 0,
    deadline: 0, status: "open", winner: "",
}

beforeEach(() => Object.values(lib).forEach((f) => f.mockReset()))

describe("Lobby", () => {
    it("lists offers and lets another player accept", async () => {
        lib.getActive.mockResolvedValue({ now: 1_000, games: [base, { ...base, id: 2, opponent: "g1carol" }] })
        lib.accept.mockResolvedValue({ hash: "h" })
        renderWithProviders(<Lobby me="g1bob" connected onOpen={vi.fn()} />)
        const row1 = await screen.findByRole("listitem", { name: /#1/ })
        expect(row1).toHaveTextContent("2 GNOT")
        expect(screen.getByRole("listitem", { name: /#2/ })).toHaveTextContent("private")
        expect(screen.getAllByRole("button", { name: "Accept" })[1]).toBeDisabled() // private, not for bob
        fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0])
        await waitFor(() => expect(lib.accept).toHaveBeenCalledWith("g1bob", expect.objectContaining({ id: 1 })))
    })

    it("disables Accept on your own and expired offers, and offers Cancel on expired ones to anyone", async () => {
        lib.getActive.mockResolvedValue({ now: 3_000, games: [base] }) // now > expiresAt
        renderWithProviders(<Lobby me="g1bob" connected onOpen={vi.fn()} />)
        const row = await screen.findByRole("listitem", { name: /#1/ })
        expect(row).toHaveTextContent("expired")
        expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled()
        expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled()
    })

    it("posts an offer, then opens the game found by commitment", async () => {
        lib.getActive.mockResolvedValueOnce({ now: 1_000, games: [] })
        lib.offer.mockResolvedValue("c".repeat(64))
        lib.getActive.mockResolvedValue({ now: 1_001, games: [{ ...base, id: 7 }] })
        const onOpen = vi.fn()
        renderWithProviders(<Lobby me="g1alice" connected onOpen={onOpen} />)
        fireEvent.change(await screen.findByLabelText("Stake (GNOT)"), { target: { value: "2" } })
        fireEvent.change(screen.getByLabelText("Valid for (minutes)"), { target: { value: "15" } })
        fireEvent.click(screen.getByRole("button", { name: "Post offer" }))
        await waitFor(() => expect(lib.offer).toHaveBeenCalledWith("g1alice", { stakeUgnot: 2_000_000, validFor: 15, opponent: "" }))
        await waitFor(() => expect(onOpen).toHaveBeenCalledWith(7))
    })

    it("blocks a stake at or below the fee without signing", async () => {
        lib.getActive.mockResolvedValue({ now: 1_000, games: [] })
        renderWithProviders(<Lobby me="g1alice" connected onOpen={vi.fn()} />)
        fireEvent.change(await screen.findByLabelText("Stake (GNOT)"), { target: { value: "0.5" } })
        expect(screen.getByRole("button", { name: "Post offer" })).toBeDisabled()
    })

    it("asks to connect a wallet before offering", async () => {
        lib.getActive.mockResolvedValue({ now: 1_000, games: [base] })
        renderWithProviders(<Lobby me="" connected={false} onOpen={vi.fn()} />)
        expect(await screen.findByText(/Connect your wallet to play/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Post offer" })).toBeNull()
    })

    it("tells the user when a posted offer never shows up", async () => {
        lib.getActive.mockResolvedValue({ now: 1_000, games: [] })
        lib.offer.mockResolvedValue("c".repeat(64))
        const onOpen = vi.fn()
        renderWithProviders(<Lobby me="g1alice" connected onOpen={onOpen} />)
        await screen.findByLabelText("Stake (GNOT)")
        vi.useFakeTimers({ shouldAdvanceTime: true })
        try {
            fireEvent.click(screen.getByRole("button", { name: "Post offer" }))
            await vi.advanceTimersByTimeAsync(20_000)
        } finally { vi.useRealTimers() }
        expect(await screen.findByText(/hasn't appeared yet/)).toBeInTheDocument()
        expect(onOpen).not.toHaveBeenCalled()
    })

    it("opens a live game exactly once per click", async () => {
        lib.getActive.mockResolvedValue({ now: 1_000, games: [{ ...base, status: "playing", acceptor: "g1bob", turn: 1, turnPlayer: "g1alice" }] })
        const onOpen = vi.fn()
        renderWithProviders(<Lobby me="g1bob" connected onOpen={onOpen} />)
        fireEvent.click(await screen.findByRole("button", { name: "Open game #1" }))
        expect(onOpen).toHaveBeenCalledTimes(1)

    })

    it("opens a game the creator must reveal, once; not for the acceptor", async () => {
        const g = { ...base, status: "playing" as const, acceptor: "g1bob", turn: 0 as const }
        lib.getActive.mockResolvedValue({ now: 1_000, games: [g] })
        const onOpen = vi.fn()
        renderWithProviders(<Lobby me="g1alice" connected onOpen={onOpen} />)
        await waitFor(() => expect(onOpen).toHaveBeenCalledWith(1))
        await new Promise((r) => setTimeout(r, 50))
        expect(onOpen).toHaveBeenCalledTimes(1)

        const other = vi.fn()
        renderWithProviders(<Lobby me="g1bob" connected onOpen={other} />)
        await screen.findAllByRole("listitem", { name: /#1/ })
        expect(other).not.toHaveBeenCalled()
    })

    it("filters to my games", async () => {
        lib.getActive.mockResolvedValue({ now: 1_000, games: [base, { ...base, id: 2, creator: "g1carol" }] })
        renderWithProviders(<Lobby me="g1alice" connected onOpen={vi.fn()} />)
        await screen.findByRole("listitem", { name: /#2/ })
        fireEvent.click(screen.getByLabelText("Only my games"))
        expect(screen.queryByRole("listitem", { name: /#2/ })).toBeNull()
        expect(screen.getByRole("listitem", { name: /#1/ })).toBeInTheDocument()
    })

    it("opens an open offer from the lobby, for its creator and for spectators, without hijacking Accept", async () => {
        lib.getActive.mockResolvedValue({ now: 1_000, games: [base] })
        const onOpen = vi.fn()
        const { unmount } = renderWithProviders(<Lobby me="g1alice" connected onOpen={onOpen} />)
        fireEvent.click(await screen.findByRole("button", { name: "Open game #1" }))
        expect(onOpen).toHaveBeenCalledWith(1)
        unmount()

        onOpen.mockClear()
        lib.accept.mockReturnValue(new Promise(() => {}))
        renderWithProviders(<Lobby me="" connected={false} onOpen={onOpen} />)
        fireEvent.click(await screen.findByRole("button", { name: "Open game #1" }))
        expect(onOpen).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole("button", { name: "Accept" })) // disabled for a guest: no open, no tx
        expect(onOpen).toHaveBeenCalledTimes(1)
        expect(lib.accept).not.toHaveBeenCalled()
    })

    it("an enabled Accept signs without also opening the row", async () => {
        lib.getActive.mockResolvedValue({ now: 1_000, games: [base] })
        lib.accept.mockReturnValue(new Promise(() => {})) // tx still pending
        const onOpen = vi.fn()
        renderWithProviders(<Lobby me="g1bob" connected onOpen={onOpen} />)
        fireEvent.click(await screen.findByRole("button", { name: "Accept" }))
        await waitFor(() => expect(lib.accept).toHaveBeenCalled())
        expect(onOpen).not.toHaveBeenCalled()
    })
})
