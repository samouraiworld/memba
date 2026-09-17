import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { DAOProposal, VoteRecord } from '../lib/dao'

// The DAO dashboard's "needs your vote" set must only drop a proposal on an
// exact voter match (full address or resolved username), never on a voter that
// merely shares the wallet's address prefix.
const ADDR = 'g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m'
const LOOKALIKE = 'g1aeddlftlqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'

const state = vi.hoisted(() => ({ voters: [] as string[] }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-router-dom')>(), useOutletContext: () => ({ auth: { isAuthenticated: true, token: null }, adena: { address: 'g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m' } }) }))
vi.mock('../hooks/useDaoRoute', () => ({ useDaoRoute: () => ({ realmPath: 'gno.land/r/team/dao', encodedSlug: 'team-dao' }) }))
vi.mock('../hooks/useNetworkNav', () => ({ useNetworkNav: () => vi.fn() }))
vi.mock('../contexts/JitsiContext', () => ({ useJitsiContext: () => ({ session: null, joinRoom: vi.fn() }) }))
vi.mock('../lib/profile', () => ({ resolveOnChainUsername: async () => 'alice' }))
vi.mock('../lib/quests', () => ({ completeQuest: vi.fn(), trackPageVisit: vi.fn() }))
vi.mock('../components/dao/DAOOverviewCard', () => ({ DAOOverviewCard: () => null }))
vi.mock('../components/dao/DAOMembersPreview', () => ({ DAOMembersPreview: () => null }))
vi.mock('../components/dao/DAOProposalsSection', () => ({
    DAOProposalsSection: ({ activeProposals, votedIds, enrichedIds }: { activeProposals: DAOProposal[]; votedIds: Set<number>; enrichedIds: Set<number> }) => (
        <div>
            <div data-testid="enriched">{[...enrichedIds].join(',')}</div>
            <div data-testid="needs-vote">{activeProposals.filter(p => p.status === 'open' && !votedIds.has(p.id)).map(p => p.id).join(',')}</div>
        </div>
    ),
}))
vi.mock('../lib/dao', async importOriginal => ({
    ...await importOriginal<typeof import('../lib/dao')>(),
    getDAOConfig: async () => ({ name: 'Team', description: '', threshold: '66%', memberCount: 3, memberstorePath: '', tierDistribution: [], isArchived: false }),
    getDAOMembers: async () => [{ address: 'g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m', roles: [], tier: '', votingPower: 1, username: '' }],
    getDAOProposals: async () => [{ id: 1, title: 'Fund the grant', description: '', category: '', status: 'open', author: '', tiers: [], yesPercent: 0, noPercent: 0, yesVotes: 0, noVotes: 0, abstainVotes: 0, totalVoters: 0 }],
    getProposalDetail: async () => null,
    getProposalVotes: async (): Promise<VoteRecord[]> => [{ tier: 'T1', vppm: 3, yesVoters: state.voters.map(username => ({ username, profileUrl: '' })), noVoters: [], abstainVoters: [] }],
}))
import { DAOHome } from './DAOHome'

function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(<QueryClientProvider client={client}><MemoryRouter><DAOHome /></MemoryRouter></QueryClientProvider>)
}
async function needsVote() {
    await waitFor(() => expect(screen.getByTestId('enriched')).toHaveTextContent('1'))
    // Let the username query settle so both match inputs are present.
    await new Promise(r => setTimeout(r, 0))
    return screen.getByTestId('needs-vote').textContent
}
beforeEach(() => { state.voters = [] })

describe('DAO dashboard voted set uses exact voter matching', () => {
    it.each([
        ['an address sharing the wallet prefix', LOOKALIKE],
        ['a username containing the wallet prefix', `@${ADDR.slice(0, 10)}_fan`],
    ])('still counts the proposal as needing a vote when %s voted', async (_label, voter) => {
        state.voters = [voter]
        mount()
        expect(await needsVote()).toBe('1')
    })
    it.each([
        ['the full wallet address', ADDR],
        ['the resolved username', '@alice'],
    ])('treats the proposal as voted when %s voted', async (_label, voter) => {
        state.voters = [voter]
        mount()
        await waitFor(() => expect(screen.getByTestId('needs-vote')).toHaveTextContent(/^$/))
        expect(screen.getByTestId('enriched')).toHaveTextContent('1')
    })
})
