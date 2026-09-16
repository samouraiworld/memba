import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ProposalView } from './ProposalView'
import type { VoteRecord } from '../lib/dao'

// "Already voted" must only be derived from an exact voter match: another
// account whose address or username merely shares the wallet's prefix must not
// hide the vote controls.
const ADDR = 'g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m'
const LOOKALIKE = 'g1aeddlftlqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'

const state = vi.hoisted(() => ({ yesVoters: [] as Array<{ username: string; profileUrl: string }> }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-router-dom')>(), useOutletContext: () => ({ auth: { isAuthenticated: true }, adena: { address: 'g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m' } }) }))
vi.mock('../hooks/useDaoRoute', () => ({ useDaoRoute: () => ({ realmPath: 'gno.land/r/team/dao', encodedSlug: 'gno.land/r/team/dao', proposalId: '4' }) }))
vi.mock('../hooks/useNetworkNav', () => ({ useNetworkNav: () => vi.fn() }))
vi.mock('../hooks/useProposalDate', () => ({ useProposalDate: () => ({ timestamp: null }) }))
vi.mock('../lib/profile', () => ({ resolveOnChainUsername: async () => 'alice' }))
vi.mock('../components/dao/AnalystReport', () => ({ AnalystReport: () => null }))
vi.mock('../components/dao/TierPieChart', () => ({ VotingInsights: () => null }))
vi.mock('../lib/dao/voteScanner', async importOriginal => ({ ...await importOriginal<typeof import('../lib/dao/voteScanner')>(), clearVoteCache: vi.fn() }))
vi.mock('../lib/dao', async importOriginal => ({
    ...await importOriginal<typeof import('../lib/dao')>(),
    getProposalDetail: async () => ({ id: 4, title: 'Review community policy', description: 'Read the proposed action.', status: 'open', author: '@bruno', authorProfile: '', tiers: [], yesVotes: 1, noVotes: 0, abstainVotes: 0, proposer: '', category: '' }),
    getProposalVotes: async (): Promise<VoteRecord[]> => [{ tier: 'T1', vppm: 3, yesVoters: state.yesVoters, noVoters: [], abstainVoters: [] }],
    getDAOConfig: async () => ({ name: 'Team', memberCount: 10, threshold: '66%', memberstorePath: '', isArchived: false }),
    getDAOMembers: async () => [{ address: 'g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m' }],
}))
function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(<QueryClientProvider client={client}><MemoryRouter><ProposalView /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { state.yesVoters = [] })

describe('voted state uses exact voter matching', () => {
    it.each([
        ['an address sharing the wallet prefix', LOOKALIKE],
        ['a username containing the wallet prefix', `@${ADDR.slice(0, 10)}_fan`],
        ['a near username', '@alice2'],
    ])('keeps vote controls when %s voted', async (_label, voter) => {
        state.yesVoters = [{ username: voter, profileUrl: '' }]
        mount()
        expect(await screen.findByRole('button', { name: 'Vote Yes on this proposal' })).toBeEnabled()
        expect(screen.queryByText(/You voted/)).not.toBeInTheDocument()
    })
    it.each([
        ['the full wallet address', ADDR],
        ['the resolved username', '@alice'],
    ])('shows the recorded vote when %s voted', async (_label, voter) => {
        state.yesVoters = [{ username: voter, profileUrl: '' }]
        mount()
        expect(await screen.findByText('✓ You voted YES on this proposal')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Vote Yes on this proposal' })).not.toBeInTheDocument()
    })
})
