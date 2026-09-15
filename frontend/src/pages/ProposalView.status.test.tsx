import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ProposalView } from './ProposalView'
import { buildExecuteMsg, buildVoteMsg } from '../lib/dao'
import { readFileSync } from 'node:fs'
import { resilientAbciQuery } from '../lib/rpcFallback'

const fixture = readFileSync('src/lib/dao/testdata/gnoland-1/govdao-proposal-4.md', 'utf8')
vi.mock('../lib/rpcFallback', async importOriginal => ({ ...await importOriginal<typeof import('../lib/rpcFallback')>(), resilientAbciQuery: vi.fn() }))

const state = vi.hoisted(() => ({
    authenticated: true, member: true, archived: false, status: 'open',
    broadcast: vi.fn().mockResolvedValue(undefined),
    address: 'g1testmember',
}))
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
    getProposalVotes: async () => [],
    getDAOConfig: async () => ({ name: 'Team', memberCount: 10, threshold: '66%', memberstorePath: '', isArchived: state.archived }),
    getDAOMembers: async () => state.member ? [{ address: state.address }] : [],
}))
function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(<QueryClientProvider client={client}><MemoryRouter><ProposalView /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
    state.authenticated = true; state.member = true; state.archived = false; state.status = 'open'; state.broadcast.mockClear()
    vi.mocked(resilientAbciQuery).mockImplementation(async () => fixture.replace(
        'PROPOSAL HAS BEEN ACCEPTED',
        state.status === 'open' ? 'Proposal is open for votes' : `PROPOSAL HAS BEEN ${state.status === 'passed' ? 'ACCEPTED' : state.status.toUpperCase()}`,
    ))
})
describe('transaction controls using the real proposal parser', () => {
    it('requires the existing confirmation and sends the same vote message', async () => {
        mount()
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
        state.member = false; mount()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Vote Yes on this proposal' })).toBeDisabled())
        expect(state.broadcast).not.toHaveBeenCalled()
    })
    it.each(['open', 'passed'])('retains archive restrictions for %s proposals', async status => {
        state.status = status; state.archived = true; mount()
        await screen.findByText('This DAO is archived — voting and execution are disabled')
        expect(screen.queryByRole('button', { name: 'Vote Yes on this proposal' })).not.toBeInTheDocument()
        expect(state.broadcast).not.toHaveBeenCalled()
    })
    it('preserves execution payload and eligibility', async () => {
        state.status = 'passed'; mount()
        const execute = await screen.findByRole('button', { name: 'Execute proposal 4' })
        expect(screen.queryByRole('button', { name: 'Vote Yes on this proposal' })).not.toBeInTheDocument()
        expect(state.broadcast).not.toHaveBeenCalled()
        fireEvent.click(execute)
        await waitFor(() => expect(state.broadcast).toHaveBeenCalledWith([buildExecuteMsg(state.address, 'gno.land/r/team/dao', 4)], 'Execute Proposal #4'))
    })
    it.each(['rejected', 'executed'])('offers no actions for %s proposals', async status => {
        state.status = status; mount()
        await screen.findByText('Proposal to unlock the transfer of ugnot.')
        expect(screen.queryByRole('button', { name: 'Vote Yes on this proposal' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Execute proposal 4' })).not.toBeInTheDocument()
        expect(state.broadcast).not.toHaveBeenCalled()
    })
    it('retains execution membership restrictions', async () => {
        state.status = 'passed'; state.member = false; mount()
        await screen.findByText('Proposal to unlock the transfer of ugnot.')
        expect(screen.queryByRole('button', { name: 'Execute proposal 4' })).not.toBeInTheDocument()
        expect(state.broadcast).not.toHaveBeenCalled()
    })
    it.each(['open', 'passed'])('does not expose %s transaction actions to a disconnected reader', async status => {
        state.status = status; state.authenticated = false; mount()
        await screen.findByText('Proposal to unlock the transfer of ugnot.')
        expect(screen.queryByRole('button', { name: 'Vote Yes on this proposal' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Execute proposal 4' })).not.toBeInTheDocument()
        expect(state.broadcast).not.toHaveBeenCalled()
    })
})
