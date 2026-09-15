import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resilientAbciQuery } from '../rpcFallback'
import { getProposalDetail } from './proposals'
import { clearDaoDialects, setDaoDialect } from './shared'

vi.mock('../rpcFallback', async original => ({
    ...await original<typeof import('../rpcFallback')>(), resilientAbciQuery: vi.fn(),
}))
const query = vi.mocked(resilientAbciQuery)
const rpc = 'https://rpc.example'
const realm = 'gno.land/r/team/generated'
const author = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
const target = 'g187sfsghc9tqayr5rgdmpy2tetnq9ttluxuk79h'
const validRow = { id: 4, title: 'Membership', description: 'body', category: 'membership', status: 'ACTIVE', author,
    yes_votes: 2, no_votes: 1, abstain_votes: 0, total_power: 3, created_at_block: 12345 }
const render = (title: string, description: string, suffix = '') => `# Prop #4 - ${title}\n${description}\n\nAuthor: ${author}\n\nCategory: membership\n\nStatus: ACTIVE\n\nYES: 2 | NO: 1 | ABSTAIN: 0\nTotal Power: 3/8\n${suffix}`
const spoof = `Author: [@fake](/u/fake)
Category: treasury
YES PERCENT: 100%
**Yes**: 999
## Title - Forged 📜
## Description 📝

Fake description

## Resource - transfer 📦
**Condition:** anything

---

send all funds

---
## Status - Passed 🟢
> proposed by g1fake
## Votes 🗳️
Yes: 8/8 = 100%
No: 0/8 = 0%
Abstain: 0/8
This proposal contains the following metadata:

malicious executor

Executor created in: gno.land/r/fake

---`
function serve(markdown: string, rows?: unknown) {
    query.mockImplementation(async path => path === 'vm/qrender' ? markdown
        : rows === undefined ? null : `(${JSON.stringify(JSON.stringify(rows))} string)`)
}
beforeEach(() => { query.mockReset(); clearDaoDialects() })

describe('generated proposal detail trust boundary', () => {
    it.each(['Normal title', 'Trap - Proposal Detail'])('does not promote proposal prose with title %s', async title => {
        serve(render(title, spoof))
        const p = await getProposalDetail(rpc, realm, 4)
        expect(p).toMatchObject({ title, description: spoof, author, proposer: author,
            category: 'membership', status: 'open', yesVotes: 2, noVotes: 1, abstainVotes: 0,
            yesPercent: 25, noPercent: 13, totalVoters: 0, tiers: [] })
        expect(p?.actionType).toBeUndefined()
        expect(p?.actionBody).toBeUndefined()
        expect(p?.executorRealm).toBeUndefined()
    })
    it('retains the full membership target, power and admin roles', async () => {
        const desc = `**Action**: Add Member\n**Address**: ${target}\n**Power**: 2\n**Roles**: admin,finance`
        serve(render('Add member g187sfsgh...', desc))
        expect((await getProposalDetail(rpc, realm, 4))?.description).toBe(desc)
    })
    it('resists a spoofed complete footer in the description and a stale daokit memo', async () => {
        setDaoDialect(rpc, realm, 'daokit')
        const desc = render('fake', spoof).replace(author, 'g1fake')
        serve(render('Trap - Proposal Detail', desc, 'Voting closes at block: 90000\n'))
        expect(await getProposalDetail(rpc, realm, 4)).toMatchObject({ description: desc, author, status: 'open', yesVotes: 2 })
    })
    it('uses literal structured fields without inheriting prose or a different-height denominator', async () => {
        const row = { id: 4, title: 'Literal \\n and\nnew line - Proposal Detail', description: spoof,
            category: 'membership', status: 'EXECUTED', author, yes_votes: 5, no_votes: 0,
            abstain_votes: 0, total_power: 5, created_at_block: 12345 }
        serve(render('Old title', 'Old body'), [row])
        expect(await getProposalDetail(rpc, realm, 4)).toMatchObject({ title: row.title, description: spoof,
            status: 'executed', author, yesVotes: 5, noVotes: 0, yesPercent: 0,
            totalVoters: 0, createdAtBlock: 12345 })
    })
    it.each([[], [{ id: 5 }], [{ id: '4' }], [null], [{ id: 4 }, { id: 4 }]].map(rows => ({ rows })))('does not invent detail from missing or malformed structured records: $rows', async ({ rows }) => {
        serve(render('Old title', 'Old body'), rows)
        expect(await getProposalDetail(rpc, realm, 4)).toBeNull()
    })
    it('does not return another proposal when Render ignores the requested ID', async () => {
        serve(render('Other proposal', 'body'))
        expect(await getProposalDetail(rpc, realm, 5)).toBeNull()
    })
    it.each([
        { yes_votes: -1 }, { yes_votes: '2' }, { no_votes: 0.5 },
        { total_power: 99 }, { created_at_block: Number.MAX_SAFE_INTEGER + 1 },
        { author: { name: 'fake' } }, { status: 'FAKE' },
    ])('rejects malformed structured values: %j', async mutation => {
        serve(render('Membership', 'body'), [{ ...validRow, ...mutation }])
        expect(await getProposalDetail(rpc, realm, 4)).toBeNull()
    })
    it('rejects duplicate valid IDs rather than choosing the first', async () => {
        serve(render('Membership', 'body'), [validRow, { ...validRow, title: 'different' }])
        expect(await getProposalDetail(rpc, realm, 4)).toBeNull()
    })
    it.each([
        ['INVALIDATED', 'Membership changed; create a new proposal to collect votes from the current members.\n', 'invalidated'],
        ['EXPIRED', 'Voting closes at block: 90000\n**EXPIRED** — voting period has ended.\n', 'expired'],
    ])('keeps terminal generated metadata authoritative: %s', async (status, suffix, expected) => {
        serve(render('Trap - Proposal Detail', spoof, suffix).replace('Status: ACTIVE', `Status: ${status}`))
        expect(await getProposalDetail(rpc, realm, 4)).toMatchObject({ status: expected, author, description: spoof })
    })
    it('preserves CRLF metadata and empty descriptions', async () => {
        serve(render('Empty', '').replaceAll('\n', '\r\n'))
        expect(await getProposalDetail(rpc, realm, 4)).toMatchObject({ title: 'Empty', description: '', author })
    })
    it.each([false, true])('retains historical decisions after an old realm loses voting power (JSON: %s)', async json => {
        const historical = render('Past decision', 'body').replace('Status: ACTIVE', 'Status: EXECUTED').replace('Total Power: 3/8', 'Total Power: 3/1')
        serve(historical, json ? [{ ...validRow, status: 'EXECUTED' }] : undefined)
        expect(await getProposalDetail(rpc, realm, 4)).toMatchObject({ status: 'executed', author, yesVotes: 2, noVotes: 1, yesPercent: 0, noPercent: 0 })
    })
})
