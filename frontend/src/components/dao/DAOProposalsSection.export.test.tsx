import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DAOProposal } from "../../lib/dao"
import { DAOProposalsSection } from "./DAOProposalsSection"

vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))

const proposal = (over: Partial<DAOProposal>) => ({ id: 1, title: "Title", description: "", category: "", status: "open", author: "g1x", authorProfile: "", tiers: [], yesPercent: 0, noPercent: 0, yesVotes: 0, noVotes: 0, abstainVotes: 0, totalVoters: 0, proposer: "g1x", ...over } as DAOProposal)

describe("legacy proposal list CSV export", () => {
    afterEach(() => vi.restoreAllMocks())

    it("exports active and completed proposals as neutralized CSV", async () => {
        let blob: Blob | undefined
        vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blob = b as Blob; return "blob:x" })
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
        render(<MemoryRouter><DAOProposalsSection encodedSlug="gno.land/r/alice/team" realmPath="gno.land/r/alice/team" isAuthenticated={false} isArchived={false} isMember={false} memberCount={1}
            activeProposals={[proposal({ id: 2, title: "=sum" })]} completedProposals={[proposal({ id: 1, title: "Done", status: "executed" })]}
            votedIds={new Set()} enrichedIds={new Set()} proposalsLoading={false} /></MemoryRouter>)
        fireEvent.click(screen.getByRole("button", { name: /export csv/i }))
        const lines = (await blob!.text()).split("\n")
        expect(lines).toHaveLength(3)
        expect(lines[1]).toContain(`"'=sum"`)
        expect(lines[2]).toContain(`"Done"`)
    })
})
