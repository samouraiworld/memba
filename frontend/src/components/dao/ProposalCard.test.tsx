/**
 * ProposalCard — vote-load-failure honesty (P1-8).
 *
 * The card hides the vote bar when a proposal has no votes, so a *failed* vote
 * enrichment is otherwise indistinguishable from a genuine no-votes proposal.
 * When enrichment failed, the card must say so instead of silently looking empty.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { DAOProposal } from "../../lib/dao/shared"
import { ProposalCard } from "./ProposalCard"

vi.mock("../../hooks/useProposalDate", () => ({
    useProposalDate: () => ({ timestamp: null, loading: false }),
}))

function makeProposal(overrides: Partial<DAOProposal> = {}): DAOProposal {
    return {
        id: 1, title: "Test proposal", description: "", category: "governance",
        status: "open", author: "@alice", authorProfile: "", tiers: [],
        yesPercent: 0, noPercent: 0, yesVotes: 0, noVotes: 0, abstainVotes: 0,
        totalVoters: 0, proposer: "g1abc",
        ...overrides,
    }
}

function renderCard(proposal: DAOProposal) {
    return render(
        <ProposalCard
            proposal={proposal}
            hasVoted={false}
            isMember={true}
            enriched={true}
            totalMembers={10}
            onClick={() => { }}
        />,
    )
}

describe("ProposalCard — vote-load-failure honesty (P1-8)", () => {
    it("shows a 'couldn't load votes' note when enrichment failed", () => {
        renderCard(makeProposal({ enrichFailed: true }))
        expect(screen.getByText(/couldn.?t load votes/i)).toBeInTheDocument()
    })

    it("does NOT show the note for a normally-enriched no-votes proposal", () => {
        renderCard(makeProposal({ enrichFailed: false }))
        expect(screen.queryByText(/couldn.?t load votes/i)).not.toBeInTheDocument()
    })
})
