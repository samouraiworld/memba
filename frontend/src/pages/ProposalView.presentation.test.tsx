import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ProposalView } from './ProposalView'
import { buildExecuteMsg, buildVoteMsg } from '../lib/dao'

const state = vi.hoisted(() => ({
    professional: true, authenticated: true, member: true, archived: false, status: 'open',
    broadcast: vi.fn().mockResolvedValue(undefined),
    address: 'g1testmember',
}))
vi.mock('../lib/proGovernance', () => ({ isProGovernanceRoute: () => state.professional }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-router-dom')>(), useOutletContext: () => ({ auth: { isAuthenticated: state.authenticated }, adena: { address: state.authenticated ? state.address : '' } }) }))
vi.mock('../hooks/useDaoRoute', () => ({ useDaoRoute: () => ({ realmPath: 'gno.land/r/team/dao', encodedSlug: 'gno.land/r/team/dao', proposalId: '4' }) }))
vi.mock('../hooks/useNetworkNav', () => ({ useNetworkNav: () => vi.fn() }))
vi.mock('../hooks/useProposalDate', () => ({ useProposalDate: () => ({ timestamp: null }) }))
vi.mock('../lib/profile', () => ({ resolveOnChainUsername: async () => 'alice' }))
vi.mock('../components/dao/AnalystReport', () => ({ AnalystReport: () => null }))
vi.mock('../components/dao/TierPieChart', () => ({ VotingInsights: () => <div>Legacy voting insights</div> }))
vi.mock('../lib/grc20', async importOriginal => ({ ...await importOriginal<typeof import('../lib/grc20')>(), doContractBroadcast: state.broadcast }))
vi.mock('../lib/dao/voteScanner', () => ({ clearVoteCache: vi.fn() }))
vi.mock('../lib/dao', async importOriginal => ({
    ...await importOriginal<typeof import('../lib/dao')>(),
    getProposalDetail: async () => ({ id: 4, title: 'Review community policy', description: 'Read the proposed action.', status: state.status, author: '@bruno', authorProfile: '', tiers: [], yesVotes: 1, noVotes: 0, abstainVotes: 0, proposer: '', category: '', actionBody: 'PublishPolicy()' }),
    getProposalVotes: async () => [],
    getDAOConfig: async () => ({ name: 'Team', memberCount: 10, threshold: '66%', memberstorePath: '', isArchived: state.archived }),
    getDAOMembers: async () => state.member ? [{ address: state.address }] : [],
}))
function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(<QueryClientProvider client={client}><MemoryRouter><ProposalView /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { state.professional = true; state.authenticated = true; state.member = true; state.archived = false; state.status = 'open'; state.broadcast.mockClear() })
for (const professional of [false, true]) {
    describe(`transaction parity with preview ${professional ? 'on' : 'off'}`, () => {
        it('requires the existing confirmation and sends the same vote message', async () => {
            state.professional = professional; mount()
            const vote = await screen.findByRole('button', { name: 'Vote Yes on this proposal' })
            fireEvent.click(vote)
            expect(screen.getByRole('alertdialog', { name: 'Confirm vote' })).toBeVisible()
            expect(state.broadcast).not.toHaveBeenCalled()
            fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
            expect(state.broadcast).not.toHaveBeenCalled()
            fireEvent.click(vote)
            fireEvent.click(screen.getByRole('button', { name: 'Confirm YES', exact: true }))
            await waitFor(() => expect(state.broadcast).toHaveBeenCalledWith([buildVoteMsg(state.address, 'gno.land/r/team/dao', 4, 'YES')], 'Vote YES on Proposal #4'))
        })
        it('retains non-member restrictions', async () => {
            state.professional = professional; state.member = false; mount()
            await waitFor(() => expect(screen.getByRole('button', { name: 'Vote Yes on this proposal' })).toBeDisabled())
            expect(state.broadcast).not.toHaveBeenCalled()
        })
        it('retains archive restrictions', async () => {
            state.professional = professional; state.archived = true; mount()
            await screen.findByText('This DAO is archived — voting and execution are disabled')
            expect(screen.queryByRole('button', { name: 'Vote Yes on this proposal' })).not.toBeInTheDocument()
            expect(state.broadcast).not.toHaveBeenCalled()
        })
        it('preserves execution payload and eligibility', async () => {
            state.professional = professional; state.status = 'passed'; mount()
            fireEvent.click(await screen.findByRole('button', { name: 'Execute proposal 4' }))
            await waitFor(() => expect(state.broadcast).toHaveBeenCalledWith([buildExecuteMsg(state.address, 'gno.land/r/team/dao', 4)], 'Execute Proposal #4'))
        })
        it('does not expose transaction actions to a disconnected reader', async () => {
            state.professional = professional; state.authenticated = false; mount()
            await screen.findByText('Review community policy')
            expect(screen.queryByRole('button', { name: 'Vote Yes on this proposal' })).not.toBeInTheDocument()
            expect(screen.queryByRole('button', { name: 'Execute proposal 4' })).not.toBeInTheDocument()
            expect(state.broadcast).not.toHaveBeenCalled()
        })
    })
}
