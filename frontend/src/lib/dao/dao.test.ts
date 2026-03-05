/**
 * Unit tests for dao.ts — DAO ABCI parsers + message builders.
 *
 * Strategy: export internal pure functions for direct testing,
 * test message builders via their public API.
 */
import { describe, it, expect } from 'vitest'
import {
    buildVoteMsg,
    buildExecuteMsg,
    buildProposeMsg,
    buildArchiveMsg,
    buildAssignRoleMsg,
    buildRemoveRoleMsg,
    // Internal functions exported for testing (via _test exports)
    _normalizeStatus,
    _parseProposalList,
    _sanitize,
    _parseMemberstoreTiers,
    _parseMembersFromRender,
} from './index'

// ── normalizeStatus ─────────────────────────────────────────────

describe('normalizeStatus', () => {
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
    it('parses v5.3.0 format (roles + pipe + power)', () => {
        const data = `## Members (3)
- g1addr1 (roles: admin, dev) | power: 3
- g1addr2 (roles: member) | power: 1
- g1addr3 (roles: finance) | power: 2
`
        const members = _parseMembersFromRender(data)
        expect(members).toHaveLength(3)
        expect(members[0].address).toBe('g1addr1')
        expect(members[0].roles).toEqual(['admin', 'dev'])
        expect(members[0].votingPower).toBe(3)
        expect(members[1].roles).toEqual(['member'])
    })

    it('parses v5.0.x format (power only)', () => {
        const data = `## Members (2)
- g1abc (power: 1)
- g1def (power: 2)
`
        const members = _parseMembersFromRender(data)
        expect(members).toHaveLength(2)
        expect(members[0].address).toBe('g1abc')
        expect(members[0].votingPower).toBe(1)
        expect(members[0].roles).toEqual([])
    })

    it('parses legacy em dash format', () => {
        const data = `## Members
- g1abc (roles: admin) — power: 5
`
        const members = _parseMembersFromRender(data)
        expect(members).toHaveLength(1)
        expect(members[0].votingPower).toBe(5)
    })

    it('returns empty array for no members', () => {
        expect(_parseMembersFromRender('No members')).toEqual([])
    })
})

// ── Message Builders ────────────────────────────────────────────

describe('buildVoteMsg', () => {
    it('builds GovDAO vote msg with MustVoteOnProposalSimple', () => {
        const msg = buildVoteMsg('g1caller', 'gno.land/r/gov/dao', 42, 'YES')
        expect(msg.type).toBe('vm/MsgCall')
        expect(msg.value.func).toBe('MustVoteOnProposalSimple')
        expect(msg.value.args).toEqual(['42', 'YES'])
        expect(msg.value.pkg_path).toBe('gno.land/r/gov/dao')
        expect(msg.value.caller).toBe('g1caller')
    })

    it('builds Memba DAO vote msg with VoteOnProposal', () => {
        const msg = buildVoteMsg('g1caller', 'gno.land/r/samcrew/mydao', 1, 'NO')
        expect(msg.value.func).toBe('VoteOnProposal')
        expect(msg.value.args).toEqual(['1', 'NO'])
    })

    it('handles ABSTAIN vote', () => {
        const msg = buildVoteMsg('g1caller', 'gno.land/r/samcrew/dao', 0, 'ABSTAIN')
        expect(msg.value.args).toEqual(['0', 'ABSTAIN'])
    })

    it('includes correct caller address', () => {
        const msg = buildVoteMsg('g1specificaddr', 'gno.land/r/gov/dao', 1, 'YES')
        expect(msg.value.caller).toBe('g1specificaddr')
    })
})

describe('buildExecuteMsg', () => {
    it('builds execute message with correct function and args', () => {
        const msg = buildExecuteMsg('g1caller', 'gno.land/r/samcrew/dao', 5)
        expect(msg.type).toBe('vm/MsgCall')
        expect(msg.value.func).toBe('ExecuteProposal')
        expect(msg.value.args).toEqual(['5'])
        expect(msg.value.pkg_path).toBe('gno.land/r/samcrew/dao')
    })
})

describe('buildProposeMsg', () => {
    it('builds GovDAO propose msg with 2 args (no category)', () => {
        const msg = buildProposeMsg('g1caller', 'gno.land/r/gov/dao', 'Title', 'Desc')
        expect(msg.value.func).toBe('Propose')
        expect(msg.value.args).toEqual(['Title', 'Desc'])
    })

    it('builds Memba DAO propose msg with 3 args (category)', () => {
        const msg = buildProposeMsg('g1caller', 'gno.land/r/samcrew/dao', 'Title', 'Desc', 'treasury')
        expect(msg.value.func).toBe('Propose')
        expect(msg.value.args).toEqual(['Title', 'Desc', 'treasury'])
    })

    it('defaults category to "governance" for Memba DAOs', () => {
        const msg = buildProposeMsg('g1caller', 'gno.land/r/samcrew/dao', 'T', 'D')
        expect(msg.value.args).toEqual(['T', 'D', 'governance'])
    })
})

describe('buildArchiveMsg', () => {
    it('builds archive message with no args', () => {
        const msg = buildArchiveMsg('g1admin', 'gno.land/r/samcrew/dao')
        expect(msg.type).toBe('vm/MsgCall')
        expect(msg.value.func).toBe('Archive')
        expect(msg.value.args).toEqual([])
        expect(msg.value.caller).toBe('g1admin')
    })
})

// ── Member Management Builders ──────────────────────────────────

describe('buildAssignRoleMsg', () => {
    it('builds AssignRole MsgCall with target and role', () => {
        const msg = buildAssignRoleMsg('g1admin', 'gno.land/r/samcrew/dao', 'g1target', 'dev')
        expect(msg.type).toBe('vm/MsgCall')
        expect(msg.value.func).toBe('AssignRole')
        expect(msg.value.args).toEqual(['g1target', 'dev'])
        expect(msg.value.pkg_path).toBe('gno.land/r/samcrew/dao')
        expect(msg.value.caller).toBe('g1admin')
    })

    it('includes correct caller for admin role assignment', () => {
        const msg = buildAssignRoleMsg('g1specificadmin', 'gno.land/r/user/mydao', 'g1member', 'admin')
        expect(msg.value.caller).toBe('g1specificadmin')
        expect(msg.value.args).toEqual(['g1member', 'admin'])
    })
})

describe('buildRemoveRoleMsg', () => {
    it('builds RemoveRole MsgCall with target and role', () => {
        const msg = buildRemoveRoleMsg('g1admin', 'gno.land/r/samcrew/dao', 'g1target', 'finance')
        expect(msg.type).toBe('vm/MsgCall')
        expect(msg.value.func).toBe('RemoveRole')
        expect(msg.value.args).toEqual(['g1target', 'finance'])
        expect(msg.value.pkg_path).toBe('gno.land/r/samcrew/dao')
    })

    it('includes correct caller for role removal', () => {
        const msg = buildRemoveRoleMsg('g1myadmin', 'gno.land/r/user/dao', 'g1member', 'member')
        expect(msg.value.caller).toBe('g1myadmin')
        expect(msg.value.args[0]).toBe('g1member')
    })
})

// ── isGovDAO detection ──────────────────────────────────────────

describe('GovDAO detection (via buildVoteMsg)', () => {
    it('detects gno.land/r/gov/dao as GovDAO', () => {
        const msg = buildVoteMsg('g1x', 'gno.land/r/gov/dao', 1, 'YES')
        expect(msg.value.func).toBe('MustVoteOnProposalSimple')
    })

    it('detects gno.land/r/gov/dao/v3 as GovDAO', () => {
        const msg = buildVoteMsg('g1x', 'gno.land/r/gov/dao/v3', 1, 'YES')
        expect(msg.value.func).toBe('MustVoteOnProposalSimple')
    })

    it('does NOT detect user DAOs as GovDAO', () => {
        const msg = buildVoteMsg('g1x', 'gno.land/r/samcrew/samourai_dao', 1, 'YES')
        expect(msg.value.func).toBe('VoteOnProposal')
    })
})

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
