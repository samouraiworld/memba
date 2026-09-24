import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { QuickVoteWidget } from "./QuickVoteWidget"

const navigate = vi.fn()
vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkNav: () => navigate }))

const base = { daoName: "Memba DAO", daoSlug: "gno.land~r~samcrew~memba_dao", realmPath: "gno.land/r/samcrew/memba_dao", proposalStatus: "voting" }
beforeEach(() => navigate.mockReset())

it("offers no vote buttons for read-only weighted proposals and links to their workspace", () => {
    const onVote = vi.fn()
    render(<QuickVoteWidget votingId={null} votedIds={new Set()} onVote={onVote} proposals={[
        { ...base, proposalId: 85, proposalTitle: "Market config · set-fee", readOnly: true, href: "/weighted-dao/gno.land/r/samcrew/memba_dao" },
        { ...base, realmPath: "gno.land/r/alice/team", daoSlug: "gno.land~r~alice~team", proposalId: 3, proposalTitle: "Text" },
    ]} />)
    expect(screen.queryByRole("button", { name: "Vote YES on proposal 85" })).toBeNull()
    expect(screen.getByRole("button", { name: "Vote YES on proposal 3" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Review proposal 85 (read-only)" }))
    expect(navigate).toHaveBeenCalledWith("/weighted-dao/gno.land/r/samcrew/memba_dao")
    fireEvent.click(screen.getByText(/#85/))
    expect(navigate).toHaveBeenLastCalledWith("/weighted-dao/gno.land/r/samcrew/memba_dao")
    expect(onVote).not.toHaveBeenCalled()
})
