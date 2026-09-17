/**
 * Unit tests for daoTemplate.ts — the DAO realm generator (template memba-dao/2).
 *
 * Covers the generator's validation (fails closed), the static shape of the
 * generated realm (exports, imports, caller identity, value-typed actions),
 * presets, the deploy message and realm path validation. The realm's runtime
 * behaviour is proven natively in daoTemplate.v2.gno.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
    generateDAOCode,
    buildDeployDAOMsg,
    validateRealmPath,
    isValidGnoAddress,
    isDeployableMemberAddress,
    daoStepError,
    DAO_PRESETS,
    DAO_TEMPLATE_VERSION,
    DAO_API_VERSION,
    type DAOCreationConfig,
} from './daoTemplate'

const ALICE = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
const BOB = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'

function makeConfig(overrides: Partial<DAOCreationConfig> = {}): DAOCreationConfig {
    return {
        name: 'Test DAO',
        description: 'A test DAO',
        realmPath: 'gno.land/r/test/mydao',
        members: [
            { address: ALICE, power: 3, roles: ['admin'] },
            { address: BOB, power: 1, roles: ['member'] },
        ],
        threshold: 51,
        roles: ['admin', 'member'],
        quorum: 0,
        proposalCategories: ['governance'],
        votingPeriodSeconds: 3 * 86400,
        executionDelaySeconds: 3600,
        executionWindowSeconds: 7 * 86400,
        ...overrides,
    }
}

/** Exported crossing functions: name -> parameter list (without `cur realm`). */
function crossingExports(code: string): Map<string, string> {
    const out = new Map<string, string>()
    for (const m of code.matchAll(/^func ([A-Z]\w*)\(cur realm(?:, ([^)]*))?\)/gm)) out.set(m[1], m[2] ?? '')
    return out
}

// ── Generated realm shape ───────────────────────────────────────

describe('generateDAOCode — realm shape', () => {
    it('declares the package and the template and API versions', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toMatch(/^package mydao\n/)
        expect(DAO_TEMPLATE_VERSION).toBe('memba-dao/2')
        expect(DAO_API_VERSION).toBe('2.0')
        expect(code).toContain('TemplateVersion  = "memba-dao/2"')
        expect(code).toContain('APIVersion       = "2.0"')
        expect(code).toContain('func GetTemplateVersion() string')
    })

    it('exposes exactly the proposal, vote and execute entrypoints (no privileged roles)', () => {
        const exports = crossingExports(generateDAOCode(makeConfig()))
        expect([...exports.keys()].sort()).toEqual([
            'Execute', 'ProposeAddMember', 'ProposeArchive', 'ProposeRemoveMember', 'ProposeSetRoles', 'ProposeText', 'Vote',
        ])
    })

    it('crossing entrypoints take primitive arguments only', () => {
        for (const [name, params] of crossingExports(generateDAOCode(makeConfig()))) {
            // Go groups names that share a type: "title, desc string".
            const groups = params.split(',').map((p) => p.trim().split(/\s+/)).filter((g) => g[0])
            expect(groups.at(-1)?.length, `${name}: last parameter has a type`).toBe(2)
            for (const group of groups.filter((g) => g.length === 2)) {
                expect(['string', 'int', 'uint64', 'address'], `${name}: ${group.join(' ')}`).toContain(group[1])
            }
        }
    })

    it('reads the caller from cur.Previous() at the top of every crossing function', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).not.toContain('unsafe')
        expect(code).not.toContain('OriginCaller')
        for (const name of crossingExports(code).keys()) {
            expect(code).toMatch(new RegExp(`func ${name}\\(cur realm[^\\n]*\\{\\n\\tcaller := cur\\.Previous\\(\\)\\.Address\\(\\)\\n`))
        }
    })

    it('imports no other realm and uses no recover', () => {
        const code = generateDAOCode(makeConfig())
        const imports = code.slice(code.indexOf('import ('), code.indexOf(')', code.indexOf('import (')))
        expect(imports.match(/"[^"]+"/g)).toEqual(['"chain"', '"strconv"', '"strings"', '"time"', '"unicode/utf8"', '"gno.land/p/nt/avl/v0"'])
        expect(code).not.toMatch(/gno\.land\/r\//)
        expect(code).not.toMatch(/\brecover\(/)
    })

    it('stores the action by value inside the proposal and dispatches by kind', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toMatch(/\tAction\s+Action\n/)
        expect(code).not.toMatch(/\*Action\b/)
        const execute = code.slice(code.indexOf('func Execute('), code.indexOf('// ── Reads'))
        expect(execute).toContain('switch a.Kind {')
        expect(execute.indexOf('validateAction(a)')).toBeLessThan(execute.indexOf('switch a.Kind {'))
        expect(execute.indexOf('switch a.Kind {')).toBeLessThan(execute.indexOf('p.Status = statusExecuted'))
    })

    it('uses overflow-safe comparisons for threshold and quorum', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toContain('return part*100 >= whole*pct')
        expect(code).not.toMatch(/\* 100 \/ /)
    })

    it('exports IsMember and IsArchived for companion realms', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toContain('func IsMember(addr address) bool')
        expect(code).toContain('func IsArchived() bool')
    })

    it('exports bounded, paginated JSON reads', () => {
        const code = generateDAOCode(makeConfig())
        for (const sig of [
            'func GetConfigJSON() string',
            'func GetMembersJSON(offset, limit int) string',
            'func GetProposalsJSON(before uint64, limit int) string',
            'func GetProposalJSON(id uint64) string',
            'func GetVotesJSON(id uint64, offset, limit int) string',
            'func HasVoted(id uint64, addr address) bool',
            'func GetStateJSON(offset, limit int) string',
        ]) expect(code).toContain(sig)
        expect(code).toContain('maxPageSize      = 50')
    })

    it('emits events for creation, votes, execution and archive', () => {
        const code = generateDAOCode(makeConfig())
        for (const event of ['ProposalCreated', 'VoteCast', 'ProposalExecuted', 'DAOArchived']) {
            expect(code).toContain(`chain.Emit("${event}"`)
        }
    })

    it('writes members, roles, categories, thresholds and windows exactly as configured', () => {
        const code = generateDAOCode(makeConfig({
            threshold: 66, quorum: 50, roles: ['admin', 'dev', 'member'], proposalCategories: ['governance', 'operations'],
            votingPeriodSeconds: 7 * 86400, executionDelaySeconds: 0, executionWindowSeconds: 14 * 86400,
        }))
        expect(code).toContain(`\taddGenesisMember("${ALICE}", 3, []string{"admin"})`)
        expect(code).toContain(`\taddGenesisMember("${BOB}", 1, []string{"member"})`)
        expect(code).toMatch(/threshold\s+= 66 /)
        expect(code).toMatch(/quorum\s+= 50 /)
        expect(code).toContain('votingPeriod    = int64(604800)')
        expect(code).toContain('executionDelay  = int64(0)')
        expect(code).toContain('executionWindow = int64(1209600)')
        expect(code).toContain('allowedCategories = []string{"governance", "operations"}')
        expect(code).toContain('allowedRoles      = []string{"admin", "dev", "member"}')
    })

    it('encodes name and description as Go string literals and pre-encoded JSON', () => {
        const code = generateDAOCode(makeConfig({ name: 'My "Evil" DAO \\ ${x}', description: 'line1\nline2 `tick`' }))
        expect(code).toContain('name            = "My \\"Evil\\" DAO \\\\ ${x}"')
        expect(code).toContain('description     = "line1\\nline2 `tick`"')
        expect(code).toContain('nameJSON        = "\\"My \\\\\\"Evil\\\\\\" DAO \\\\\\\\ ${x}\\""')
    })
})

// ── Validation ──────────────────────────────────────────────────

describe('generateDAOCode — fails closed', () => {
    it.each([
        ['name too long', { name: 'x'.repeat(65) }, /at most 64/],
        ['name too short', { name: 'ab' }, /at least 3/],
        ['name with newline', { name: 'line1\nline2' }, /not allowed/],
        ['name with a line separator', { name: 'a\u2028b DAO' }, /not allowed/],
        ['name with a lone surrogate', { name: 'bad \ud800 name' }, /not allowed/],
        ['description too long', { description: 'x'.repeat(1001) }, /at most 1000/],
        ['description with NUL', { description: 'a\u0000b' }, /not allowed/],
        ['description with a lone surrogate', { description: '\udc00' }, /not allowed/],
        ['threshold 50', { threshold: 50 }, /threshold/i],
        ['threshold 101', { threshold: 101 }, /threshold/i],
        ['fractional threshold', { threshold: 60.5 }, /threshold/i],
        ['quorum -1', { quorum: -1 }, /quorum/i],
        ['quorum NaN', { quorum: NaN }, /quorum/i],
        ['voting period under an hour', { votingPeriodSeconds: 3599 }, /votingPeriodSeconds/],
        ['voting period over 30 days', { votingPeriodSeconds: 30 * 86400 + 1 }, /votingPeriodSeconds/],
        ['negative delay', { executionDelaySeconds: -1 }, /executionDelaySeconds/],
        ['delay over 7 days', { executionDelaySeconds: 7 * 86400 + 1 }, /executionDelaySeconds/],
        ['window under a day', { executionWindowSeconds: 86399 }, /executionWindowSeconds/],
        ['window over 30 days', { executionWindowSeconds: 30 * 86400 + 1 }, /executionWindowSeconds/],
        ['invalid realm path', { realmPath: 'gno.land/r/x/evil"\n' }, /realmPath/i],
        ['reserved package name', { realmPath: 'gno.land/r/test/return' }, /package/i],
        ['no members', { members: [] }, /member/i],
        ['bad address checksum', { members: [{ address: ALICE.slice(0, -1) + 'd', power: 1, roles: [] }] }, /checksum/i],
        ['address shape', { members: [{ address: 'INVALID"; panic("x', power: 1, roles: [] }] }, /address/i],
        ['zero power', { members: [{ address: ALICE, power: 0, roles: [] }] }, /power/i],
        ['power above the bound', { members: [{ address: ALICE, power: 1_000_000_001, roles: [] }] }, /power/i],
        ['fractional power', { members: [{ address: ALICE, power: 2.5, roles: [] }] }, /power/i],
        ['duplicate member', { members: [{ address: ALICE, power: 1, roles: [] }, { address: ALICE, power: 2, roles: [] }] }, /duplicate/i],
        ['undeclared member role', { members: [{ address: ALICE, power: 1, roles: ['owner'] }] }, /role/i],
        ['duplicate member role', { members: [{ address: ALICE, power: 1, roles: ['admin', 'admin'] }] }, /role/i],
        ['invalid role label', { roles: ['admin', 'BAD ROLE'] }, /role/i],
        ['too many roles', { roles: Array.from({ length: 17 }, (_, i) => `r${i}`) }, /roles/i],
        ['no categories', { proposalCategories: [] }, /categor/i],
        ['category injection', { proposalCategories: ['governance', '"; INJECT("'] }, /categor/i],
    ] as [string, Partial<DAOCreationConfig>, RegExp][])('%s', (_label, change, error) => {
        expect(() => generateDAOCode(makeConfig(change))).toThrow(error)
    })

    it('refuses more than 100 members', () => {
        const members = Array.from({ length: 101 }, (_, i) => ({ address: `g1${String(i).padStart(38, 'q')}`, power: 1, roles: [] }))
        expect(() => generateDAOCode(makeConfig({ members }))).toThrow(/at most 100 members/)
    })

    it('does not require an admin role: roles are labels only', () => {
        const code = generateDAOCode(makeConfig({ roles: ['member'], members: [{ address: ALICE, power: 1, roles: [] }] }))
        expect(code).toContain(`addGenesisMember("${ALICE}", 1, []string{})`)
    })

    it('accepts the boundary values', () => {
        expect(() => generateDAOCode(makeConfig({
            name: 'x'.repeat(64), description: 'y'.repeat(1000), threshold: 51, quorum: 100,
            votingPeriodSeconds: 3600, executionDelaySeconds: 0, executionWindowSeconds: 86400,
            members: [{ address: ALICE, power: 1_000_000_000, roles: [] }],
        }))).not.toThrow()
        expect(() => generateDAOCode(makeConfig({
            threshold: 100, votingPeriodSeconds: 30 * 86400, executionDelaySeconds: 7 * 86400, executionWindowSeconds: 30 * 86400,
        }))).not.toThrow()
    })
})

describe('isDeployableMemberAddress', () => {
    it('requires the bech32 checksum on top of the address shape', () => {
        expect(isDeployableMemberAddress(ALICE)).toBe(true)
        expect(isValidGnoAddress('g1' + 'a'.repeat(38))).toBe(true)
        expect(isDeployableMemberAddress('g1' + 'a'.repeat(38))).toBe(false)
        expect(isDeployableMemberAddress(ALICE.toUpperCase())).toBe(false)
    })
})

// ── Wizard step validation ──────────────────────────────────────

describe('daoStepError', () => {
    const base = { name: 'My DAO', realmPath: 'gno.land/r/test/mydao', members: [{ address: ALICE, roles: [], power: 1 }], threshold: 51, quorum: 0 }

    it('step 1 checks name length and characters', () => {
        expect(daoStepError(1, base)).toBeNull()
        expect(daoStepError(1, { ...base, name: 'x'.repeat(65) })).toMatch(/at most 64/)
        expect(daoStepError(1, { ...base, name: 'bad\nname' })).toMatch(/not allowed/)
    })

    it('step 2 checks the checksum and the power range, and no longer requires an admin', () => {
        expect(daoStepError(2, base)).toBeNull()
        expect(daoStepError(2, { ...base, members: [{ address: 'g1' + 'a'.repeat(38), roles: [] }] })).toMatch(/checksum/)
        for (const power of [0, -1, 2.5, NaN, 9_999_999_999]) {
            expect(daoStepError(2, { ...base, members: [{ address: ALICE, roles: [], power }] })).toMatch(/power/i)
        }
    })

    it('step 3 requires a threshold above 50 %', () => {
        expect(daoStepError(3, { ...base, threshold: 50 })).toBe('Threshold must be between 51 and 100')
        expect(daoStepError(3, { ...base, threshold: NaN })).toMatch(/threshold/i)
        expect(daoStepError(3, { ...base, quorum: NaN })).toMatch(/quorum/i)
        expect(daoStepError(3, { ...base, threshold: 51, quorum: 40 })).toBeNull()
    })
})

// ── Presets ─────────────────────────────────────────────────────

describe('DAO_PRESETS', () => {
    it('offers Basic, Team and Enterprise (no treasury preset: generated DAOs hold no funds)', () => {
        expect(DAO_PRESETS.map((p) => p.id)).toEqual(['basic', 'team', 'enterprise'])
        for (const preset of DAO_PRESETS) {
            expect(preset.categories).not.toContain('treasury')
            expect(preset.description.toLowerCase()).not.toMatch(/treasury|funds/)
        }
    })

    it('carries the planned voting period, delay and window', () => {
        const days = (n: number) => n * 86400
        const windows = Object.fromEntries(DAO_PRESETS.map((p) => [p.id, [p.votingPeriodSeconds, p.executionDelaySeconds, p.executionWindowSeconds]]))
        expect(windows).toEqual({
            basic: [days(3), 3600, days(7)],
            team: [days(2), 3600, days(7)],
            enterprise: [days(7), 86400, days(14)],
        })
    })

    it('every preset generates a valid realm', () => {
        for (const preset of DAO_PRESETS) {
            expect(() => generateDAOCode(makeConfig({
                roles: preset.roles, proposalCategories: preset.categories, threshold: preset.threshold, quorum: preset.quorum,
                votingPeriodSeconds: preset.votingPeriodSeconds, executionDelaySeconds: preset.executionDelaySeconds,
                executionWindowSeconds: preset.executionWindowSeconds, members: [{ address: ALICE, power: 1, roles: [] }],
            }))).not.toThrow()
        }
    })
})

// ── buildDeployDAOMsg ───────────────────────────────────────────

describe('buildDeployDAOMsg', () => {
    it('builds a /vm.m_addpkg message with the package files sorted and a max_deposit cap', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/test/zdao', 'package zdao\n', '13000000ugnot')
        expect(msg.value.max_deposit).toBe('13000000ugnot')
        expect(msg.value).not.toHaveProperty('deposit')
        expect(msg.type).toBe('/vm.m_addpkg')
        expect(msg.value.creator).toBe('g1caller')
        const pkg = msg.value.package as { name: string; files: { name: string; body: string }[] }
        expect(pkg.name).toBe('zdao')
        expect(pkg.files.map((f) => f.name)).toEqual(['gnomod.toml', 'zdao.gno'])
        expect(pkg.files[0].body).toBe('module = "gno.land/r/test/zdao"\ngno = "0.9"\n')
    })
})

// ── validateRealmPath ───────────────────────────────────────────

describe('validateRealmPath', () => {
    it('accepts valid paths', () => {
        expect(validateRealmPath('gno.land/r/zooma/mydao')).toBeNull()
        expect(validateRealmPath('gno.land/r/sam_crew/my_dao')).toBeNull()
    })

    it('rejects malformed paths', () => {
        expect(validateRealmPath('cosmos.land/r/test/dao')).toBe('Must start with gno.land/r/')
        expect(validateRealmPath('gno.land/r/zooma')).toContain('namespace and realm name')
        expect(validateRealmPath('gno.land/r/zooma/ab')).toContain('at least 3')
        expect(validateRealmPath('gno.land/r/zooma/' + 'a'.repeat(31))).toContain('at most 30')
        expect(validateRealmPath('gno.land/r//dao')).toContain('cannot be empty')
        expect(validateRealmPath('gno.land/r/zooma/my-dao')).not.toBeNull()
    })
})
