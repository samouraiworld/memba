import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useGnoloveAIReports } from "../../hooks/gnolove"
import GnoloveAIReports from "./GnoloveAIReports"

vi.mock("../../hooks/gnolove", () => ({ useGnoloveAIReports: vi.fn() }))

const query = vi.mocked(useGnoloveAIReports)
const show = () => render(<MemoryRouter><GnoloveAIReports /></MemoryRouter>)

describe("GnoloveAIReports availability", () => {
    it("distinguishes an API failure from an empty report archive and retries", () => {
        const refetch = vi.fn()
        query.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch } as never)
        show()
        expect(screen.getByRole("heading", { name: "AI Reports", level: 1 })).toBeInTheDocument()
        expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load AI reports")
        expect(screen.queryByText("No AI reports available yet.")).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(refetch).toHaveBeenCalledOnce()
    })

    it("reserves the empty message for a successful empty response", () => {
        query.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() } as never)
        show()
        expect(screen.getByRole("heading", { name: "AI Reports", level: 1 })).toBeInTheDocument()
        expect(document.title).toBe("AI Reports | Gnolove · Memba")
        expect(screen.getByText("No AI reports available yet.")).toBeInTheDocument()
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })
})
