import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProProposalVotes } from './ProProposalVotes'
import type { DAOProposal } from '../../lib/dao'
const proposal: DAOProposal = { id: 1, title: 'Example', description: '', category: '', status: 'open', author: '', authorProfile: '', tiers: [], yesPercent: 80, noPercent: 20, yesVotes: 0, noVotes: 0, abstainVotes: 0, totalVoters: 0, proposer: '' }
it('never turns percentages or absent configuration into invented votes or a default threshold', () => {
    render(<ProProposalVotes proposal={proposal} records={[]} members={0} />)
    expect(screen.getByText('Vote totals are unavailable or have not yet been recorded.')).toBeVisible()
    expect(screen.queryByText('80')).not.toBeInTheDocument()
    expect(screen.queryByText('60%')).not.toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
})
it('includes abstentions in the reported total without predicting the outcome', () => {
    render(<ProProposalVotes proposal={{ ...proposal, yesVotes: 2, noVotes: 1, abstainVotes: 3 }} records={[]} members={10} threshold="66%" />)
    expect(screen.getByText('6 reported')).toBeVisible()
    expect(screen.getByText('66%')).toBeVisible()
    expect(screen.getByText(/Proposal conditions can differ/)).toBeVisible()
})
