/**
 * Unit tests for dao.ts — DAO ABCI parsers.
 *
 * Strategy: export internal pure functions for direct testing,
 * test message builders via their public API.
 */
import { describe, it, expect } from 'vitest'
import { bech32Encode } from './realmAddress'
import {
    // Internal functions exported for testing (via _test exports)
    _normalizeStatus,
    _parseProposalList,
    _parseProposalDescription,
    _parseProposalAuthor,
    _parseVoters,
    _sanitize,
    _unescapeMarkdown,
    _parseMemberstoreTiers,
    _parseMembersFromRender,
    _parseMemberstoreRows,
    deriveRoleLabel,
    type DAOMember,
} from './index'

const mkMember = (over: Partial<DAOMember> = {}): DAOMember => ({
    address: 'g1abc',
    roles: [],
    tier: '',
    votingPower: 0,
    username: '',
    ...over,
})

// ── normalizeStatus ─────────────────────────────────────────────

describe('normalizeStatus', () => {
    it('keeps invalidated proposals closed to voting', () => {
        expect(_normalizeStatus('INVALIDATED')).toBe('invalidated')
        expect(_normalizeStatus(' invalidated ')).toBe('invalidated')
    })

    it('keeps expired proposals closed to voting', () => {
        expect(_normalizeStatus('EXPIRED')).toBe('expired')
        expect(_normalizeStatus('expired')).toBe('expired')
    })

    it('maps "ACCEPTED" → "passed"', () => {
        expect(_normalizeStatus('ACCEPTED')).toBe('passed')
    })

    it('maps "ACTIVE" → "open"', () => {
        expect(_normalizeStatus('ACTIVE')).toBe('open')
    })

    it('maps "REJECTED" → "rejected"', () => {
        expect(_normalizeStatus('REJECTED')).toBe('rejected')
    })

    it('maps "EXECUTED" → "executed"', () => {
        expect(_normalizeStatus('EXECUTED')).toBe('executed')
    })

    it('maps "passed" → "passed"', () => {
        expect(_normalizeStatus('passed')).toBe('passed')
    })

    it('maps "failed" → "rejected"', () => {
        expect(_normalizeStatus('failed')).toBe('rejected')
    })

    it('maps "completed" → "executed"', () => {
        expect(_normalizeStatus('completed')).toBe('executed')
    })

    // gno govdao v3 detail render emits "**PROPOSAL HAS BEEN DENIED**"; the
    // detail status regex captures the token "DENIED". Without a denied branch
    // this fell through to the default "open", so a denied proposal rendered as
    // ACTIVE (LIVE badge + vote buttons) on the detail page. Regression guard.
    it('maps "DENIED" → "rejected" (GovDAO proposal-detail prose)', () => {
        expect(_normalizeStatus('DENIED')).toBe('rejected')
    })

    it('maps "denied" (any case) → "rejected"', () => {
        expect(_normalizeStatus('denied')).toBe('rejected')
        expect(_normalizeStatus('Denied')).toBe('rejected')
    })

    it('defaults unknown statuses to "open"', () => {
        expect(_normalizeStatus('unknown')).toBe('open')
        expect(_normalizeStatus('')).toBe('open')
    })

    it('is case-insensitive', () => {
        expect(_normalizeStatus('Accepted')).toBe('passed')
        expect(_normalizeStatus('active')).toBe('open')
        expect(_normalizeStatus('REJECTED')).toBe('rejected')
    })
})

// ── sanitize ────────────────────────────────────────────────────

describe('sanitize', () => {
    it('allows alphanumeric and safe chars', () => {
        expect(_sanitize('members?page=2')).toBe('members?page=2')
    })

    it('strips unsafe characters', () => {
        expect(_sanitize('test<script>')).toBe('testscript')
    })

    it('allows slashes and colons', () => {
        expect(_sanitize('proposal/1')).toBe('proposal/1')
        expect(_sanitize('gno.land:render')).toBe('gno.land:render')
    })

    it('allows hyphens and underscores', () => {
        expect(_sanitize('some-path_name')).toBe('some-path_name')
    })

    it('strips spaces and special chars', () => {
        expect(_sanitize('hello world!')).toBe('helloworld')
        expect(_sanitize('test;drop')).toBe('testdrop')
    })

    it('allows query params with ampersands', () => {
        expect(_sanitize('members?page=1&filter=T1')).toBe('members?page=1&filter=T1')
    })
})

// ── unescapeMarkdown (gno#5418 compatibility) ─────────────────

describe('unescapeMarkdown', () => {
    it('strips backslash escapes from markdown special chars', () => {
        expect(_unescapeMarkdown('Upgrade to v2\\.0 \\(critical\\)')).toBe('Upgrade to v2.0 (critical)')
    })

    it('handles bracket escapes', () => {
        expect(_unescapeMarkdown('Add \\[new\\] validators')).toBe('Add [new] validators')
    })

    it('passes through clean text unchanged', () => {
        expect(_unescapeMarkdown('Normal title without escapes')).toBe('Normal title without escapes')
    })

    it('handles asterisk and underscore escapes', () => {
        expect(_unescapeMarkdown('\\*bold\\* and \\_italic\\_')).toBe('*bold* and _italic_')
    })

    it('handles empty string', () => {
        expect(_unescapeMarkdown('')).toBe('')
    })
})

// ── parseProposalList ───────────────────────────────────────────

describe('parseProposalList', () => {
    it('parses GovDAO v3 proposal format', () => {
        const data = `# GovDAO

## Proposals

### [Prop #42 - Add new member](link)
Author: [@zooma](https://gno.land/u/zooma)
Category: governance
Status: ACTIVE
Tiers eligible to vote: T1, T2, T3

---

### [Prop #41 - Treasury transfer](link)
Author: [@samcrew](https://gno.land/u/samcrew)
Category: treasury
Status: ACCEPTED
Tiers eligible to vote: T1
`
        const proposals = _parseProposalList(data)
        expect(proposals).toHaveLength(2)

        expect(proposals[0].id).toBe(42)
        expect(proposals[0].title).toBe('Add new member')
        expect(proposals[0].author).toBe('@zooma')
        expect(proposals[0].category).toBe('governance')
        expect(proposals[0].status).toBe('open')
        expect(proposals[0].tiers).toEqual(['T1', 'T2', 'T3'])

        expect(proposals[1].id).toBe(41)
        expect(proposals[1].title).toBe('Treasury transfer')
        expect(proposals[1].status).toBe('passed')
        expect(proposals[1].tiers).toEqual(['T1'])
    })

    it('parses basedao proposal fallback format', () => {
        const data = `# My DAO

## Proposals

### Proposal #1: First proposal
Status: ACTIVE

### Proposal #2: Second proposal
Status: ACCEPTED
`
        const proposals = _parseProposalList(data)
        expect(proposals).toHaveLength(2)
        expect(proposals[0].id).toBe(1)
        expect(proposals[0].title).toBe('First proposal')
        expect(proposals[1].id).toBe(2)
    })

    it('handles empty proposals section', () => {
        const data = '# My DAO\n\n## Proposals\nNo proposals yet.\n'
        expect(_parseProposalList(data)).toHaveLength(0)
    })

    it('handles GovDAO author with raw g1 address', () => {
        const data = `### [Prop #1 - Test](link)
Author: g1abcdef1234567890abcdef1234567890abcdef
Status: ACTIVE
`
        const proposals = _parseProposalList(data)
        expect(proposals).toHaveLength(1)
        expect(proposals[0].author).toBe('g1abcdef1234567890abcdef1234567890abcdef')
    })

    it('handles proposals with no tiers', () => {
        const data = `### [Prop #5 - Simple](link)
Author: [@user](url)
Status: ACTIVE
`
        const proposals = _parseProposalList(data)
        expect(proposals[0].tiers).toEqual([])
    })
})

// ── parseMemberstoreTiers ───────────────────────────────────────

describe('parseMemberstoreTiers', () => {
    it('parses tier distribution from memberstore render', () => {
        const data = `# Memberstore

Tier T1 contains 11 members with power: 33
Tier T2 contains 5 members with power: 10
Tier T3 contains 20 members with power: 20
`
        const tiers = _parseMemberstoreTiers(data)
        expect(tiers).toHaveLength(3)
        expect(tiers[0]).toEqual({ tier: 'T1', memberCount: 11, power: 33 })
        expect(tiers[1]).toEqual({ tier: 'T2', memberCount: 5, power: 10 })
        expect(tiers[2]).toEqual({ tier: 'T3', memberCount: 20, power: 20 })
    })

    it('handles single tier', () => {
        const data = 'Tier T1 contains 1 member with power: 3'
        const tiers = _parseMemberstoreTiers(data)
        expect(tiers).toHaveLength(1)
        expect(tiers[0].tier).toBe('T1')
        expect(tiers[0].memberCount).toBe(1)
    })

    it('returns empty array for no tiers', () => {
        expect(_parseMemberstoreTiers('No tiers here')).toEqual([])
    })

    it('is case insensitive', () => {
        const data = 'tier t1 contains 2 members with power: 5'
        const tiers = _parseMemberstoreTiers(data)
        expect(tiers).toHaveLength(1)
        expect(tiers[0].tier).toBe('T1')
    })
})

// ── parseMembersFromRender ──────────────────────────────────────

describe('parseMembersFromRender', () => {
    const V = (i: number) => bech32Encode('g', new Uint8Array(20).fill(i))

    it('parses v5.3.0 format (roles + pipe + power)', () => {
        const data = `## Members (3)
- ${V(1)} (roles: admin, dev) | power: 3
- ${V(2)} (roles: member) | power: 1
- ${V(3)} (roles: finance) | power: 2
`
        const members = _parseMembersFromRender(data)
        expect(members).toHaveLength(3)
        expect(members[0].address).toBe(V(1))
        expect(members[0].roles).toEqual(['admin', 'dev'])
        expect(members[0].votingPower).toBe(3)
        expect(members[1].roles).toEqual(['member'])
    })

    it('parses v5.0.x format (power only)', () => {
        const data = `## Members (2)
- ${V(4)} (power: 1)
- ${V(5)} (power: 2)
`
        const members = _parseMembersFromRender(data)
        expect(members).toHaveLength(2)
        expect(members[0].address).toBe(V(4))
        expect(members[0].votingPower).toBe(1)
        expect(members[0].roles).toEqual([])
    })

    it('parses legacy em dash format', () => {
        const data = `## Members
- ${V(4)} (roles: admin) — power: 5
`
        const members = _parseMembersFromRender(data)
        expect(members).toHaveLength(1)
        expect(members[0].votingPower).toBe(5)
    })

    it('returns empty array for no members', () => {
        expect(_parseMembersFromRender('No members')).toEqual([])
    })
})

// ── parseMemberstoreRows ────────────────────────────────────────

describe('parseMemberstoreRows', () => {
    it('parses tier + address from memberstore table rows', () => {
        const data = `| ![T1 chip](data:img) T1 | g1aaa |
| ![T2 chip](data:img) T2 | g1bbb |`
        expect(_parseMemberstoreRows(data)).toEqual([
            { tier: 'T1', address: 'g1aaa' },
            { tier: 'T2', address: 'g1bbb' },
        ])
    })

    it('uppercases the tier', () => {
        expect(_parseMemberstoreRows('x t3 | g1ccc |')).toEqual([{ tier: 'T3', address: 'g1ccc' }])
    })

    it('returns [] when there are no rows', () => {
        expect(_parseMemberstoreRows('no table here')).toEqual([])
    })
})

// ── deriveRoleLabel ─────────────────────────────────────────────

describe('deriveRoleLabel', () => {
    it('returns undefined for a null member (not a member / unresolved)', () => {
        expect(deriveRoleLabel(null)).toBeUndefined()
    })

    it('prefers a recognised privileged role over a plain one', () => {
        expect(deriveRoleLabel(mkMember({ roles: ['member', 'admin'] }))).toBe('admin')
    })

    it('is case-insensitive on privileged roles', () => {
        expect(deriveRoleLabel(mkMember({ roles: ['OWNER'] }))).toBe('owner')
    })

    it('falls back to the first explicit role when none are privileged', () => {
        expect(deriveRoleLabel(mkMember({ roles: ['finance'] }))).toBe('finance')
    })

    it('falls back to the power tier when there are no roles', () => {
        expect(deriveRoleLabel(mkMember({ roles: [], tier: 'T1' }))).toBe('T1')
    })

    it('falls back to "member" when there are no roles and no tier', () => {
        expect(deriveRoleLabel(mkMember({ roles: [], tier: '' }))).toBe('member')
    })
})

// Message builders are covered by builders.abi.test.ts (kind-checked, ABI-pinned).

// ── DAO config heading strip (R1 fix) ──────────────────────────

describe('DAO config heading strip', () => {
    /** Replicates the heading-strip logic from config.ts */
    function stripDescriptionHeadings(description: string): string {
        return description.replace(/^#+\s+/gm, '').trim()
    }

    function stripNameHeading(name: string): string {
        return name.replace(/^#+\s*/, '')
    }

    it('strips markdown heading markers from description', () => {
        const raw = '## Members\nSome text\n### Proposals\nMore text'
        expect(stripDescriptionHeadings(raw)).toBe('Members\nSome text\nProposals\nMore text')
    })

    it('preserves description without headings', () => {
        expect(stripDescriptionHeadings('Normal text here')).toBe('Normal text here')
    })

    it('strips heading marker from name', () => {
        expect(stripNameHeading('## GovDAO')).toBe('GovDAO')
        expect(stripNameHeading('### My DAO')).toBe('My DAO')
    })

    it('preserves name without heading', () => {
        expect(stripNameHeading('GovDAO')).toBe('GovDAO')
    })
})

// ── ACCEPTED → passed mapping (v2.13 verification) ─────────────

describe('ACCEPTED proposal status mapping', () => {
    const GOVDAO_DATA = `# GovDAO

## Proposals

### [Prop #9 - Add new validator](link)
Author: [@zooma](https://gno.land/u/zooma)
Status: ACCEPTED
Tiers eligible to vote: T1, T2, T3

---

### [Prop #10 - Budget proposal](link)
Author: [@samcrew](https://gno.land/u/samcrew)
Status: ACTIVE
Tiers eligible to vote: T1
`

    it('ACCEPTED proposals map to "passed" (Awaiting Execution)', () => {
        const proposals = _parseProposalList(GOVDAO_DATA)
        expect(proposals[0].status).toBe('passed')  // ACCEPTED → passed
        expect(proposals[1].status).toBe('open')     // ACTIVE → open
    })

    it('ACTIVE proposals map to "open"', () => {
        const proposals = _parseProposalList(GOVDAO_DATA)
        const active = proposals.filter(p => p.status === 'open')
        expect(active.length).toBe(1)
        expect(active[0].id).toBe(10)
    })
})

// ── parseProposalAuthor (GovDAO v3 detail render) ───────────────
// Real render shape: "Author: [@user](/u/user)" (resolved) or "Author: g1…" (raw
// address when the proposer has no registered username). The detail page used to
// only match the linked form, silently dropping bare-address authors (F-E2).

describe('parseProposalAuthor', () => {
    it('resolves a linked "[@user](url)" author', () => {
        const r = _parseProposalAuthor('## Prop #7 - X\nAuthor: [@zooma](/u/zooma)\n\nbody')
        expect(r.author).toBe('@zooma')
        expect(r.authorProfile).toBe('/u/zooma')
    })

    it('captures a bare g1 address author (was dropped on the detail page)', () => {
        const r = _parseProposalAuthor('## Prop #22 - X\nAuthor: g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5\n\nbody')
        expect(r.author).toBe('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        expect(r.authorProfile).toBe('')
    })

    it('returns empty author when none present', () => {
        expect(_parseProposalAuthor('## Prop #1 - X\n\nbody').author).toBe('')
    })
})

// ── parseVoters (GovDAO v3 votes render) ────────────────────────
// Real render shape per voter line: "- [@user](/u/user)" or "- g1…". The old
// @-link-only regex dropped bare addresses, undercounting tallies (F-E3).

describe('parseVoters', () => {
    it('captures both linked and bare-address voters in order', () => {
        const block = '\n\n- [@zooma](/u/zooma)\n- g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5\n'
        const voters = _parseVoters(block)
        expect(voters.map(v => v.username)).toEqual(['@zooma', 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'])
        expect(voters[0].profileUrl).toBe('/u/zooma')
        expect(voters[1].profileUrl).toBe('')
    })

    it('ignores non-voter lines', () => {
        expect(_parseVoters('some header text\nno bullets here')).toEqual([])
    })
})

// ── parseProposalDescription (GovDAO v3 detail render) ──────────
// The displayed/analysed body must NOT leak the executor-metadata block or the
// trailing "---" rule that precedes "### Stats" (B3/F-E5).

describe('parseProposalDescription', () => {
    it('returns the body and excludes the executor-metadata block', () => {
        const detail = [
            '## Prop #22 - Fund grant',
            'Author: g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5',
            '',
            'Fund the dev grant with 1000 GNOT to accelerate tooling.',
            '',
            'This proposal contains the following metadata:',
            '',
            'send 1000ugnot',
            '',
            'Executor created in: gno.land/r/template/contract',
            '',
            '',
            '---',
            '',
            '### Stats',
            '- **PROPOSAL HAS BEEN DENIED**',
        ].join('\n')
        expect(_parseProposalDescription(detail)).toBe('Fund the dev grant with 1000 GNOT to accelerate tooling.')
    })

    it('strips a trailing horizontal rule when there is no metadata', () => {
        const detail = [
            '## Prop #7 - Add member',
            'Author: [@zooma](/u/zooma)',
            '',
            'Add zooma as a T2 member of the DAO.',
            '',
            '---',
            '',
            '### Stats',
            '- **PROPOSAL HAS BEEN ACCEPTED**',
        ].join('\n')
        expect(_parseProposalDescription(detail)).toBe('Add zooma as a T2 member of the DAO.')
    })
})
