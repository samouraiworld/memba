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
