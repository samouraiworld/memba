import { fireEvent, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderWithProviders } from "../../test/test-utils"
import type { Game } from "../../lib/connect4"

const lib = vi.hoisted(() => ({
    getGame: vi.fn(), play: vi.fn(), reveal: vi.fn(), resign: vi.fn(), cancel: vi.fn(), claimTimeout: vi.fn(), revealKey: vi.fn(), revealSeed: vi.fn(),
}))
vi.mock("../../lib/connect4", async (orig) => ({ ...(await orig<typeof import("../../lib/connect4")>()), ...lib }))

const qp = vi.hoisted(() => ({ quickPlayOn: vi.fn(() => true), signEachMove: () => false, quickPlayDuration: () => 14400, setQuickPlayDuration: () => {} }))
vi.mock("../../lib/quickPlay", () => qp)

import { GameView } from "./GameView"

const g: Game = {
    id: 4, creator: "g1alice", opponent: "", acceptor: "g1bob", stake: 2_000_000, fee: 100_000, expiresAt: 900,
    commitment: "c".repeat(64), seedCommitment: "d".repeat(64), revealed: false, board: "0".repeat(42), turn: 1, turnPlayer: "g1alice", moves: 0, lastCol: 0, lastRow: 0,
    deadline: 1_090, status: "playing", winner: "",
}
const view = (me: string, game: Game, now = 1_000) => {
    lib.getGame.mockResolvedValue({ now, game })
    return renderWithProviders(<GameView id={4} me={me} connected={me !== ""} onBack={vi.fn()} />)
}

beforeEach(() => { Object.values(lib).forEach((f) => f.mockReset()); qp.quickPlayOn.mockReturnValue(true) })

describe("GameView", () => {
    it("lets the player on turn drop a piece", async () => {
        lib.play.mockResolvedValue({})
        view("g1alice", g)
        expect(await screen.findByText(/Your move/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: /^Drop in column 5:/ }))
        await waitFor(() => expect(lib.play).toHaveBeenCalledWith("g1alice", 4, 5, 0, {}))
    })

    it("disables the board off-turn and shows Resign", async () => {
        view("g1bob", g)
        expect(await screen.findByText(/Opponent's move/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /^Drop in column 1:/ })).toBeDisabled()
        expect(screen.getByRole("button", { name: "Resign" })).toBeEnabled()
    })

    it("is read-only for spectators but still offers Claim timeout after the deadline", async () => {
        view("", g, 1_200)
        expect(await screen.findByRole("button", { name: "Claim timeout" })).toBeEnabled()
        expect(screen.queryByRole("button", { name: "Resign" })).toBeNull()
        expect(screen.getByRole("button", { name: /^Drop in column 1:/ })).toBeDisabled()
    })

    it("after the creator's reveal, auto-reveals the acceptor's seed by its own commitment", async () => {
        lib.revealKey.mockImplementation((_me: string, c: string) => (c === "d".repeat(64) ? "myseed" : null))
        lib.revealSeed.mockResolvedValue({})
        view("g1bob", { ...g, turn: 0, turnPlayer: "", revealed: true })
        await waitFor(() => expect(lib.revealSeed).toHaveBeenCalledWith("g1bob", 4, "myseed", {}))
        expect(lib.reveal).not.toHaveBeenCalled()
        expect(screen.getByText(/Waiting for the acceptor to reveal their seed/)).toBeInTheDocument()
    })

    it("tells the acceptor to keep the tab open while the creator reveals, and the creator waits for the seed", async () => {
        lib.revealKey.mockReturnValue("x")
        const first = view("g1bob", { ...g, turn: 0, turnPlayer: "" })
        expect(await screen.findByText(/keep this tab open/)).toBeInTheDocument()
        expect(lib.revealSeed).not.toHaveBeenCalled()
        first.unmount()
        view("g1alice", { ...g, turn: 0, turnPlayer: "", revealed: true })
        expect(await screen.findByText(/Waiting for the acceptor/)).toBeInTheDocument()
        expect(lib.reveal).not.toHaveBeenCalled()
    })

    it("auto-reveals once for the creator with a stored key", async () => {
        lib.revealKey.mockReturnValue("pass")
        lib.reveal.mockRejectedValue(new Error("reveal clock ran out"))
        view("g1alice", { ...g, turn: 0, turnPlayer: "" })
        await waitFor(() => expect(lib.reveal).toHaveBeenCalledWith("g1alice", 4, "pass", {}))
        expect(await screen.findByText(/reveal clock ran out/)).toBeInTheDocument()
        await new Promise((r) => setTimeout(r, 50))
        expect(lib.reveal).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("button", { name: "Reveal" })).toBeEnabled() // manual retry
    })

    it("warns the creator when the reveal key is missing", async () => {
        lib.revealKey.mockReturnValue(null)
        view("g1alice", { ...g, turn: 0, turnPlayer: "" })
        expect(await screen.findByText(/reveal key isn't on this device/)).toBeInTheDocument()
        expect(lib.reveal).not.toHaveBeenCalled()
    })

    it("shows the winner and payout when finished", async () => {
        view("g1bob", { ...g, status: "won", winner: "g1bob", turnPlayer: "", deadline: 0 })
        expect(await screen.findByText(/You won 3.9 GNOT/)).toBeInTheDocument()
    })

    it("says not found for an unknown game", async () => {
        lib.getGame.mockResolvedValue({ now: 1, game: null })
        renderWithProviders(<GameView id={4} me="" connected={false} onBack={vi.fn()} />)
        expect(await screen.findByText(/Game #4 not found/)).toBeInTheDocument()
    })

    it("does not reveal after the reveal clock ran out", async () => {
        lib.revealKey.mockReturnValue("pass")
        view("g1alice", { ...g, turn: 0, turnPlayer: "" }, 1_200)
        expect(await screen.findByText(/reveal clock ran out/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Claim timeout" })).toBeEnabled()
        expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull()
        expect(lib.reveal).not.toHaveBeenCalled()
    })

    it("keeps the board when a later poll fails", async () => {
        lib.getGame.mockResolvedValueOnce({ now: 1_000, game: g }).mockResolvedValue(null)
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={client}><GameView id={4} me="g1alice" connected onBack={vi.fn()} /></QueryClientProvider>)
        expect(await screen.findByText(/Your move/)).toBeInTheDocument()
        await client.refetchQueries()
        expect(lib.getGame).toHaveBeenCalledTimes(2)
        expect(screen.getByText(/Your move/)).toBeInTheDocument()
        expect(screen.queryByText(/not found/)).toBeNull()
    })

    it("offers 'Use wallet instead' after a Quick play move fails, which signs via the wallet", async () => {
        lib.play.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce({})
        view("g1alice", g)
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        fireEvent.click(await screen.findByRole("button", { name: "Use wallet instead" }))
        await waitFor(() => expect(lib.play).toHaveBeenLastCalledWith("g1alice", 4, 5, 0, expect.objectContaining({ viaWallet: true })))
    })

    it("goes straight to the wallet when a Quick play move fails with under 15s left", async () => {
        lib.play.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce({})
        view("g1alice", { ...g, deadline: 1_010 })
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        await waitFor(() => expect(lib.play).toHaveBeenLastCalledWith("g1alice", 4, 5, 0, expect.objectContaining({ viaWallet: true })))
    })

    it("after an unknown outcome, offers the wallet only if it's still our turn", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        try {
            lib.play.mockRejectedValueOnce(Object.assign(new Error("Outcome unknown"), { name: "OutcomeUnknownError" }))
            view("g1alice", g)
            fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
            expect(await screen.findByText(/checking/i)).toBeInTheDocument()
            await vi.advanceTimersByTimeAsync(10_500)
            expect(await screen.findByRole("button", { name: "Sign this move with your wallet" })).toBeEnabled()
        } finally { vi.useRealTimers() }
    })

    const unknownErr = () => Object.assign(new Error("Outcome unknown"), { name: "OutcomeUnknownError" })

    it("opens the wallet at once on an unknown outcome with under 15s left", async () => {
        lib.play.mockRejectedValueOnce(unknownErr()).mockResolvedValueOnce({})
        view("g1alice", { ...g, deadline: 1_010 })
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        await waitFor(() => expect(lib.play).toHaveBeenLastCalledWith("g1alice", 4, 5, 0, expect.objectContaining({ viaWallet: true })))
    })

    it("does not open the wallet after an unknown outcome when the re-read shows the move landed", async () => {
        lib.play.mockRejectedValueOnce(unknownErr()).mockResolvedValue({})
        view("g1alice", { ...g, deadline: 1_010 })
        lib.getGame.mockResolvedValue({ now: 1_000, game: { ...g, deadline: 1_010, moves: 1, turn: 2, turnPlayer: "g1bob" } })
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        expect(await screen.findByText("Your move already landed.")).toBeInTheDocument()
        expect(lib.play).toHaveBeenCalledTimes(1)
    })

    it("sends via the wallet after an unknown outcome when the re-read shows nothing changed", async () => {
        lib.play.mockRejectedValueOnce(unknownErr()).mockResolvedValue({})
        view("g1alice", { ...g, deadline: 1_010 })
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        await waitFor(() => expect(lib.play).toHaveBeenLastCalledWith("g1alice", 4, 5, 0, expect.objectContaining({ viaWallet: true })))
        expect(lib.getGame.mock.calls.length).toBeGreaterThan(1) // the guard re-read
    })

    it("guards the wallet button too: aborts when the re-read shows the move landed", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        try {
            lib.play.mockRejectedValueOnce(unknownErr())
            view("g1alice", g)
            fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
            await screen.findByText(/checking/i)
            await vi.advanceTimersByTimeAsync(10_500)
            const btn = await screen.findByRole("button", { name: "Sign this move with your wallet" })
            lib.getGame.mockResolvedValue({ now: 1_000, game: { ...g, moves: 1, turn: 2, turnPlayer: "g1bob" } })
            fireEvent.click(btn)
            expect(await screen.findByText("Your move already landed.")).toBeInTheDocument()
            expect(lib.play).toHaveBeenCalledTimes(1)
        } finally { vi.useRealTimers() }
    })

    it("does not open the wallet twice when the automatic wallet prompt is rejected", async () => {
        lib.play.mockRejectedValueOnce(new Error("rpc down")).mockRejectedValue(new Error("user rejected"))
        view("g1alice", { ...g, deadline: 1_010 })
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        await waitFor(() => expect(lib.play).toHaveBeenCalledTimes(2))
        await screen.findByText(/user rejected/)
        await new Promise((r) => setTimeout(r, 100))
        expect(lib.play).toHaveBeenCalledTimes(2)
    })

    it("shows why Quick play fell back to the wallet", async () => {
        view("g1alice", g)
        await screen.findByText(/Your move/)
        window.dispatchEvent(new CustomEvent("memba:quickplay-fallback", { detail: "Quick play ended — confirm in your wallet." }))
        expect(await screen.findByText("Quick play ended — confirm in your wallet.")).toBeInTheDocument()
    })

    it("keeps the wallet button when the session disappears after the failure", async () => {
        lib.play.mockRejectedValueOnce(new Error("rpc down"))
        view("g1alice", g)
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        await screen.findByRole("button", { name: "Use wallet instead" })
        qp.quickPlayOn.mockReturnValue(false)
        fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }).then(() => screen.getByRole("button", { name: "Use wallet instead" })))
        await waitFor(() => expect(lib.play).toHaveBeenLastCalledWith("g1alice", 4, 5, 0, expect.objectContaining({ viaWallet: true })))
    })

    it("does not auto-route a RealmError with under 15s left, but offers the button", async () => {
        lib.play.mockRejectedValueOnce(Object.assign(new Error("not your turn"), { name: "RealmError" }))
        view("g1alice", { ...g, deadline: 1_010 })
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        expect(await screen.findByRole("button", { name: "Use wallet instead" })).toBeEnabled()
        expect(lib.play).toHaveBeenCalledTimes(1)
    })

    it("clears the unknown-outcome watch as soon as the move count advances", async () => {
        lib.play.mockRejectedValueOnce(unknownErr())
        view("g1alice", g)
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        expect(await screen.findByText(/checking/i)).toBeInTheDocument()
        lib.getGame.mockResolvedValue({ now: 1_000, game: { ...g, moves: 1, turn: 2, turnPlayer: "g1bob" } })
        await waitFor(() => expect(screen.queryByText(/checking/i)).toBeNull(), { timeout: 5000 })
    })
    it("compares recovery reads with the game as it was before the move was sent", async () => {
        let reject!: (e: Error) => void
        lib.play.mockReturnValueOnce(new Promise((_, r) => { reject = r })).mockResolvedValue({})
        lib.getGame.mockResolvedValue({ now: 1_000, game: { ...g, deadline: 1_010 } })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={client}><GameView id={4} me="g1alice" connected onBack={vi.fn()} /></QueryClientProvider>)
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        // While the move is in flight, polling sees it land and the opponent reply: our turn again.
        lib.getGame.mockResolvedValue({ now: 1_000, game: { ...g, deadline: 1_010, moves: 2 } })
        await client.refetchQueries()
        await waitFor(() => expect(screen.getByText("Moves").nextElementSibling).toHaveTextContent("2"))
        reject(unknownErr())
        expect(await screen.findByText("Your move already landed.")).toBeInTheDocument()
        expect(lib.play).toHaveBeenCalledTimes(1)
    })

    it("never re-sends an unknown move when the recovery read fails", async () => {
        lib.play.mockRejectedValueOnce(unknownErr()).mockResolvedValue({})
        view("g1alice", { ...g, deadline: 1_010 })
        const col = await screen.findByRole("button", { name: /^Drop in column 5:/ })
        lib.getGame.mockRejectedValue(new Error("rpc down"))
        fireEvent.click(col)
        expect(await screen.findByText(/Couldn't check whether your move landed/)).toBeInTheDocument()
        expect(screen.getByText(/Outcome unknown/)).toBeInTheDocument()
        expect(lib.play).toHaveBeenCalledTimes(1)
    })

    it("keeps the wallet route for an unresolved Reveal (no turn player yet)", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        try {
            lib.revealKey.mockReturnValue("pass")
            lib.reveal.mockRejectedValueOnce(unknownErr()).mockResolvedValue({})
            view("g1alice", { ...g, turn: 0, turnPlayer: "" })
            await waitFor(() => expect(lib.reveal).toHaveBeenCalledTimes(1))
            await screen.findByText(/checking/i)
            expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull()
            await vi.advanceTimersByTimeAsync(10_500)
            fireEvent.click(await screen.findByRole("button", { name: "Sign this move with your wallet" }))
            await waitFor(() => expect(lib.reveal).toHaveBeenLastCalledWith("g1alice", 4, "pass", expect.objectContaining({ viaWallet: true })))
        } finally { vi.useRealTimers() }
    })
    it("re-checks the game right before the wallet signs a re-sent move", async () => {
        lib.play.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValue({})
        view("g1alice", g)
        fireEvent.click(await screen.findByRole("button", { name: /^Drop in column 5:/ }))
        fireEvent.click(await screen.findByRole("button", { name: "Use wallet instead" }))
        await waitFor(() => expect(lib.play).toHaveBeenCalledTimes(2))
        const { beforeSign } = lib.play.mock.calls[1][4] as { beforeSign: () => Promise<void> }
        await expect(beforeSign()).resolves.toBeUndefined()
        lib.getGame.mockResolvedValue({ now: 1_000, game: { ...g, moves: 1, turn: 2, turnPlayer: "g1bob" } })
        await expect(beforeSign()).rejects.toThrow(/moved on before you signed/)
        lib.getGame.mockRejectedValue(new Error("down"))
        await expect(beforeSign()).rejects.toThrow(/Couldn't check the game/)
    })
})
