import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DAOProposal } from "../../lib/dao"
import { ProDAOProposals } from "./ProDAOProposals"

vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkPath: () => (path: string) => `/pearl/${path}` }))

describe("proposal list CSV export", () => {
    afterEach(() => vi.restoreAllMocks())

    it("exports the listed proposals as neutralized CSV", async () => {
        const proposals = [{ id: 3, title: "=cmd", author: "g1x", status: "open", yesVotes: 1, noVotes: 0, abstainVotes: 0, yesPercent: 50, noPercent: 0 } as DAOProposal]
        let blob: Blob | undefined
        vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blob = b as Blob; return "blob:x" })
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
        render(<MemoryRouter><ProDAOProposals encodedSlug="gno.land/r/alice/team" proposals={proposals} loading={false} failed={false} retry={vi.fn()} canPropose={false} votedIds={new Set()} /></MemoryRouter>)
        fireEvent.click(screen.getByRole("button", { name: /export csv/i }))
        expect(blob).toBeDefined()
        const text = await blob!.text()
        expect(text.split("\n")[1]).toContain(`"'=cmd"`)
    })
})
