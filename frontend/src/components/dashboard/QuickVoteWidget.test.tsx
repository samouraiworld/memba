import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { QuickVoteWidget } from "./QuickVoteWidget"

const navigate = vi.fn()
vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkNav: () => navigate }))

const base = { daoName: "Team", daoSlug: "gno.land~r~alice~team", realmPath: "gno.land/r/alice/team", proposalStatus: "open" }
beforeEach(() => navigate.mockReset())

it("offers vote buttons for a pending proposal and opens it at its proposal page", () => {
    const onVote = vi.fn()
    render(<QuickVoteWidget votingId={null} votedIds={new Set()} onVote={onVote} proposals={[
        { ...base, proposalId: 3, proposalTitle: "Text" },
    ]} />)
    fireEvent.click(screen.getByRole("button", { name: "Vote YES on proposal 3" }))
    expect(onVote).toHaveBeenCalledWith("gno.land/r/alice/team", 3, "YES")
    fireEvent.click(screen.getByText(/#3/))
    expect(navigate).toHaveBeenLastCalledWith("/dao/gno.land~r~alice~team/proposal/3")
})
