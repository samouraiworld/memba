import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { DAOOverviewCard } from "./DAOOverviewCard"
import { DAOCard } from "../directory/DAOCard"
import type { DAOConfig } from "../../lib/dao"

vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))

const config = (name: string): DAOConfig => ({ name, description: "", threshold: "60%", memberCount: 1, memberstorePath: "", tierDistribution: [], isArchived: false })

function overview(realmPath: string, name: string) {
    return render(<MemoryRouter><DAOOverviewCard config={config(name)} realmPath={realmPath} encodedSlug={realmPath} currentMember={undefined} isAuthenticated={false}
        memberCount={1} activeProposals={0} awaitingExecution={0} totalProposals={0} nonVoterPercent={0} nonVoterCount={0} maxVoterParticipation={0} proposalsWithVotesCount={0} totalPower={0} /></MemoryRouter>)
}

describe("DAO identity on DAO pages and cards", () => {
    it("shows Verified for GovDAO at its exact path", () => {
        overview("gno.land/r/gov/dao", "GovDAO")
        expect(screen.getByText("Verified")).toBeInTheDocument()
        expect(screen.queryByText("Unverified")).not.toBeInTheDocument()
    })

    it("shows Unverified and a lookalike warning for a verified name at another path", () => {
        overview("gno.land/r/alice/gov", "GovDAO")
        expect(screen.getByText("Unverified")).toBeInTheDocument()
        expect(screen.getByRole("alert")).toHaveTextContent("This DAO uses the name of a verified DAO at another address")
    })

    it("renders the realm path before the self-declared name", () => {
        overview("gno.land/r/alice/team", "Team")
        const path = screen.getAllByText("gno.land/r/alice/team")[0]
        const name = screen.getByRole("heading", { name: "Team" })
        expect(path.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it("directory cards show the path first and the identity label", () => {
        render(<DAOCard name="GovDAO" path="gno.land/r/bob/dao" isSaved={false} onClick={vi.fn()} />)
        const path = screen.getByText("gno.land/r/bob/dao")
        const name = screen.getByText("GovDAO")
        expect(path.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.getByText("Unverified")).toBeInTheDocument()
        expect(screen.getByRole("alert")).toBeInTheDocument()
    })
})
