import { fireEvent, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"

const lib = vi.hoisted(() => ({ getLeaders: vi.fn() }))
vi.mock("../../lib/connect4", async (orig) => ({ ...(await orig<typeof import("../../lib/connect4")>()), ...lib }))
import { Leaders } from "./Leaders"

const A = "g1cvr48r7l7lkmvp77cr6zg2zhu26jgfwr0y8pew"
const B = "g1p8xftdc9v75netuza8kgtrzg8yxaagd8u3hk5m"
beforeEach(() => lib.getLeaders.mockReset())

describe("Leaders", () => {
    it("shows most games won first, with a podium and the viewer marked", async () => {
        lib.getLeaders.mockResolvedValue({ wins: [{ addr: B, score: 12 }, { addr: A, score: 1 }], gnot: [{ addr: A, score: 1_900_000 }] })
        renderWithProviders(<Leaders me={A} />)
        const rows = within(await screen.findByRole("list")).getAllByRole("listitem")
        expect(rows[0]).toHaveTextContent("g1p8xftd…hk5m12 wins")
        expect(rows[0]).toHaveAttribute("data-rank", "1")
        expect(rows[1]).toHaveTextContent("You1 win")
        expect(rows[1]).toHaveAttribute("data-me", "true")
        expect(screen.getByRole("tab", { name: "Wins" })).toHaveAttribute("aria-selected", "true")
    })
    it("switches to GNOT won by click and by arrow key", async () => {
        lib.getLeaders.mockResolvedValue({ wins: [{ addr: B, score: 2 }], gnot: [{ addr: A, score: 1_900_000 }] })
        renderWithProviders(<Leaders me="" />)
        await screen.findByRole("list")
        fireEvent.click(screen.getByRole("tab", { name: "GNOT won" }))
        expect(screen.getByRole("listitem")).toHaveTextContent("1.9 GNOT")
        const wins = screen.getByRole("tab", { name: "Wins" })
        fireEvent.keyDown(screen.getByRole("tab", { name: "GNOT won" }), { key: "ArrowLeft" })
        expect(wins).toHaveAttribute("aria-selected", "true")
        expect(wins).toHaveFocus()
    })
    it("invites a first win when the boards are empty", async () => {
        lib.getLeaders.mockResolvedValue({ wins: [], gnot: [] })
        renderWithProviders(<Leaders me="" />)
        expect(await screen.findByText(/No finished games yet/)).toBeInTheDocument()
    })
})
