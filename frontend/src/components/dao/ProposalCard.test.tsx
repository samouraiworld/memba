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
    it("labels expired proposals without inviting another vote", () => {
        renderCard(makeProposal({ status: "expired" }))
        expect(screen.getByText("EXPIRED", { exact: true })).toBeInTheDocument()
        expect(screen.queryByText(/vote now|not voted/i)).not.toBeInTheDocument()
    })

})

describe("ProposalCard — version-2 DAOs", () => {
    const v2 = {
        id: 1, title: "Test proposal", category: "governance", author: "g1abc", action: { kind: "text" as const, target: "", power: 0, roles: [] },
        electorate_power: 100, electorate_version: 0, created_at: 1, voting_ends_at: 2, status: "LAPSED" as const,
        yes: 70, no: 0, abstain: 0, accepted_at: 1, executable_at: 1, execute_by: 2,
    }

    it("shows the realm's exact status and power tallies, without emoji badges", () => {
        renderCard(makeProposal({ status: "expired", yesVotes: 70, v2 }))
        expect(screen.getByText("LAPSED")).toBeInTheDocument()
        expect(screen.queryByText(/⚡|⏳/)).not.toBeInTheDocument()
    })

    it("marks a passed proposal for execution in plain text", () => {
        renderCard(makeProposal({ status: "passed", v2: { ...v2, status: "ACCEPTED" } }))
        expect(screen.getByText("EXECUTE")).toBeInTheDocument()
        expect(screen.getByText("ACCEPTED")).toBeInTheDocument()
    })
})
