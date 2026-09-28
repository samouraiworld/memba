import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fetchVerifiedDirectoryGovDAOProposals } from "../../../lib/directoryGovDao"
import { GovDAOTab } from "./GovDAOTab"

vi.mock("../../../lib/directoryGovDao", () => ({ fetchVerifiedDirectoryGovDAOProposals: vi.fn() }))

describe("Directory GovDAO proposals", () => {
    it("shows an RPC outage with retry instead of calling it an empty DAO", async () => {
        vi.mocked(fetchVerifiedDirectoryGovDAOProposals)
            .mockRejectedValueOnce(new Error("RPC unavailable"))
            .mockResolvedValueOnce([{ id: 1, title: "Funding proposal", status: "open", yesVotes: 0, noVotes: 0 }] as never)
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={client}><GovDAOTab navigate={vi.fn()} /></QueryClientProvider>)
        expect(await screen.findByText("RPC unavailable")).toBeInTheDocument()
        expect(screen.queryByText("No proposals found")).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("Funding proposal")).toBeInTheDocument()
        expect(fetchVerifiedDirectoryGovDAOProposals).toHaveBeenCalledWith(expect.any(String), "gno.land/r/gov/dao")
    })
})
