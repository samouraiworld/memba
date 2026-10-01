import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import GnoloveMilestone from "./GnoloveMilestone"

const mockMilestone = vi.fn()
vi.mock("../../hooks/gnolove", () => ({ useGnoloveMilestone: () => mockMilestone() }))

beforeEach(() => mockMilestone.mockReset())

describe("GnoloveMilestone", () => {
    it("marks an all-closed milestone complete while identifying its historical description", () => {
        mockMilestone.mockReturnValue({
            data: {
                number: 12, title: "Release", description: "We are right in the thick of it.",
                issues: [{ id: "1", number: 1, title: "Shipped", state: "CLOSED", url: "https://github.com/example/issue/1" }],
            },
            isLoading: false, isError: false,
        })
        render(<GnoloveMilestone />)
        expect(screen.getByText("1/1 issues closed (100%)")).toBeInTheDocument()
        expect(screen.getByText(/This milestone is complete/)).toBeInTheDocument()
        expect(screen.getByRole("heading", { name: "Original milestone description" })).toBeInTheDocument()
    })

    it("sanitises the description like every other rendered markdown: in-app links stay in the tab", () => {
        mockMilestone.mockReturnValue({
            data: { number: 12, title: "Release", description: "See [the board](/gnolove) and [GitHub](https://github.com/example).", issues: [] },
            isLoading: false, isError: false,
        })
        render(<GnoloveMilestone />)
        const board = screen.getByRole("link", { name: "the board" })
        expect(board).not.toHaveAttribute("target")
        expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("rel", "noopener noreferrer")
    })

    it("distinguishes a failed milestone read and offers retry", () => {
        const refetch = vi.fn()
        mockMilestone.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
        render(<GnoloveMilestone />)
        expect(screen.getByRole("heading", { level: 1, name: "Milestone unavailable" })).toBeInTheDocument()
        expect(document.title).toBe("Milestone unavailable | Gnolove · Memba")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(refetch).toHaveBeenCalledOnce()
    })
})
