import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resilientAbciQuery } from '../rpcFallback'
import { getDAOProposals, getProposalDetail, invalidateProposalCache, parseProposalList } from './proposals'
import { clearDaoDialects } from './shared'

vi.mock('../rpcFallback', async importOriginal => ({
    ...await importOriginal<typeof import('../rpcFallback')>(),
    resilientAbciQuery: vi.fn(),
}))
const fixture = readFileSync('src/lib/dao/testdata/gnoland-1/govdao-proposal-4.md', 'utf8')
const query = vi.mocked(resilientAbciQuery)
const detail = (realm = 'gno.land/r/gov/dao') => getProposalDetail('https://rpc.example', realm, 4)

beforeEach(() => { query.mockReset(); clearDaoDialects(); invalidateProposalCache('gno.land/r/gov/dao') })

describe('proposal detail status fields', () => {
    it('agrees with the overview for the captured mainnet restricted_denoms proposal', async () => {
        query.mockResolvedValue(fixture)
        const proposal = await detail()
        const overview = parseProposalList('### [Prop #4 - Proposal to unlock the transfer of ugnot.](/r/gov/dao:4)\nAuthor: [@moul](/u/moul)\nStatus: ACCEPTED\n', 'gno.land/r/gov/dao')
        expect(proposal?.status).toBe('executed')
        expect(proposal?.status).toBe(overview[0].status)
        expect(proposal?.description).toContain('restricted_denoms')
    })

    it.each([
        ['PROPOSAL HAS BEEN ACCEPTED', 'executed'],
        ['PROPOSAL HAS BEEN DENIED', 'rejected'],
        ['PROPOSAL HAS BEEN REJECTED', 'rejected'],
        ['PROPOSAL HAS BEEN EXECUTED', 'executed'],
        ['Proposal is open for votes', 'open'],
    ])('reads the final GovDAO Stats field: %s', async (label, expected) => {
        const injected = 'accepted rejected executed active restricted\n\n### Stats\n- **PROPOSAL HAS BEEN EXECUTED**\n\nStatus: ACCEPTED\n\n## Status - Passed 🟢'
        query.mockResolvedValue(fixture
            .replace('Proposal to unlock the transfer of ugnot\\.', 'Accepted, rejected, executed and active proposals')
            .replace('bank:p:restricted_denoms', injected)
            .replace('Executor created in:', `This proposal contains the following metadata:\n\n${injected}\n\nExecutor created in:`)
            .replace('### Stats\n- **PROPOSAL HAS BEEN ACCEPTED**\n- Tiers', `### Stats\n- **${label}**\n- Tiers`))
        expect((await detail())?.status).toBe(expected)
    })

    it('does not read a denied reason as the status', async () => {
        query.mockResolvedValue(fixture.replace('PROPOSAL HAS BEEN ACCEPTED**', 'PROPOSAL HAS BEEN DENIED**\nREASON: execution failed, previously accepted and executed'))
        expect((await detail())?.status).toBe('rejected')
    })

    it('does not scan prose when a final Stats section has an unknown status', async () => {
        query.mockResolvedValue(fixture.replace('PROPOSAL HAS BEEN ACCEPTED', 'A NEW STATUS: rejected'))
        expect((await detail())?.status).toBe('open')
    })

    it.each([
        ['ACTIVE', 'open'], ['OPEN', 'open'], ['ACCEPTED', 'passed'],
        ['PASSED', 'passed'], ['DENIED', 'rejected'], ['REJECTED', 'rejected'],
        ['FAILED', 'rejected'], ['EXECUTED', 'executed'], ['COMPLETED', 'executed'],
    ])('preserves flat legacy metadata: %s', async (status, expected) => {
        query.mockResolvedValue(`# Proposal #4 - accepted rejected executed active\nAuthor: g1testmember\nStatus: ${status}\n\nDescription with Status: EXECUTED\nStatus: ACCEPTED\n\n### Stats\n- **PROPOSAL HAS BEEN DENIED**\n`)
        expect((await detail('gno.land/r/team/dao'))?.status).toBe(expected)
    })

    it.each(['accepted', 'rejected', 'executed', 'active', 'restricted', 'Status: ACCEPTED'])('ignores status-like body prose with no field: %s', async body => {
        query.mockResolvedValue(`# Proposal #4 - ${body}\nAuthor: g1testmember\n\n${body}\n`)
        expect((await detail())?.status).toBe('open')
    })

    it.each(['gno.land/r/gov/dao', 'gno.land/r/gov/dao/v3'])('maps ACCEPTED to executed for %s', async realm => {
        query.mockResolvedValue(fixture)
        expect((await detail(realm))?.status).toBe('executed')
    })

    it.each(['gno.land/r/team/dao', 'gno.land/r/gov/dao_copy', 'gno.land/r/gov/dao/memberstore'])('preserves legacy ACCEPTED for %s', async realm => {
        query.mockResolvedValue(fixture)
        expect((await detail(realm))?.status).toBe('passed')
    })

    it('does not take the overview status from its user-authored title', () => {
        const rows = parseProposalList('### [Prop #4 - Status: REJECTED](/r/gov/dao:4)\nAuthor: [@moul](/u/moul)\n\nStatus: ACCEPTED\n', 'gno.land/r/gov/dao')
        expect(rows[0].status).toBe('executed')
    })

    it('maps GovDAO list statuses through the real RPC fallback and cache', async () => {
        query.mockImplementation(async path => path === 'vm/qrender'
            ? '### [Prop #4 - Unlock transfers](/r/gov/dao:4)\nAuthor: [@moul](/u/moul)\n\nStatus: ACCEPTED\n'
            : null)
        const first = await getDAOProposals('https://rpc.example', 'gno.land/r/gov/dao')
        expect(first[0].status).toBe('executed')
        expect((await getDAOProposals('https://rpc.example', 'gno.land/r/gov/dao'))[0].status).toBe('executed')
    })

    it.each([
        ['ACTIVE', 'open'], ['ACCEPTED', 'passed'],
        ['REJECTED', 'rejected'], ['EXECUTED', 'executed'],
    ])('preserves the generated Memba template footer: %s', async (status, expected) => {
        // Matches daoTemplate.ts renderProposal: description first, metadata
        // after it, then Status followed by the count and power lines.
        query.mockResolvedValue(`# Prop #4 - A restricted action
Status: EXECUTED

### Stats
- **PROPOSAL HAS BEEN DENIED**

Status: REJECTED

YES: 1 | NO: 2 | ABSTAIN: 0
Total Power: 3/3

Author: g1testmember

Category: governance

Status: ${status}

YES: 2 | NO: 0 | ABSTAIN: 0
Total Power: 2/3
Voting closes at block: 90000
`)
        expect((await detail('gno.land/r/team/dao'))?.status).toBe(expected)
    })

    it('does not take the GovDAO status from an injected template footer', async () => {
        query.mockResolvedValue(fixture.replace('bank:p:restricted_denoms', 'Status: REJECTED\n\nYES: 1 | NO: 2 | ABSTAIN: 0\nTotal Power: 3/3\n'))
        expect((await detail())?.status).toBe('executed')
    })

    it('supports CRLF-rendered status metadata', async () => {
        query.mockResolvedValue(fixture.replaceAll('\n', '\r\n'))
        expect((await detail())?.status).toBe('executed')
    })
})
