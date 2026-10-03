import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ArcadeWindow from "./native"

const flags = vi.hoisted(() => ({ block: true, space: false, barricade: true, connect4: true }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isGameEnabled: () => flags.block,
    isSpaceInvadersEnabled: () => flags.space,
    isBarricadeEnabled: () => flags.barricade,
    isConnect4Live: () => flags.connect4,
}))
const base = { query: undefined, close: () => {}, toast: () => {}, fallback: <p>existing game</p>, session: {} as never, openApp: () => {} }

describe("Arcade lobby", () => {
    it("shows all games, their availability, and opens each existing route", () => {
        const open = vi.fn()
        render(<ArcadeWindow {...base} section={null} open={open} />)
        expect(screen.getByRole("navigation", { name: "Arcade" })).toBeInTheDocument()
        expect(screen.getByText(/leaderboard is server-verified when Daily is live/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /Block Party/ })).toHaveTextContent("Play")
        expect(screen.getByRole("button", { name: /Space Invaders/ })).toHaveTextContent("Unavailable")
        expect(screen.getByRole("button", { name: /BARRICADE/ })).toHaveTextContent("Play")
        fireEvent.click(screen.getByRole("button", { name: /BARRICADE/ }))
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "game:barricade", target: expect.objectContaining({ section: "barricade" }) }))
        expect(screen.getByRole("button", { name: /Connect 4/ })).toHaveTextContent("Play")
        fireEvent.click(screen.getByRole("button", { name: /Connect 4/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "game:connect4", title: "Connect 4 · Arcade", target: expect.objectContaining({ section: "connect4" }) }))
    })

    it("states the limits of runs and the daily board", () => {
        const open = vi.fn()
        const { rerender } = render(<ArcadeWindow {...base} section="runs" open={open} />)
        expect(screen.getByRole("heading", { name: "Your runs" })).toBeInTheDocument()
        expect(screen.getByRole("status")).toHaveTextContent("not a certified Arcade record")
        rerender(<ArcadeWindow {...base} section="daily-board" open={open} />)
        expect(screen.getByRole("status")).toHaveTextContent("attestation is off")
        expect(screen.getByRole("status")).toHaveTextContent("Block Party has its own server-verified Daily leaderboard")
        fireEvent.click(screen.getByRole("button", { name: /Space Invaders/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ section: "space-invaders" }) }))
    })

    it("keeps the existing game pages intact", () => {
        render(<ArcadeWindow {...base} section="game" open={vi.fn()} />)
        expect(screen.getByText("existing game")).toBeInTheDocument()
    })
})
