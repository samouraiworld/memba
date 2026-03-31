/**
 * Unit tests for daoTemplate.ts — DAO realm code generator.
 *
 * Tests cover: code generation correctness, input validation,
 * injection prevention, MsgAddPackage builder, and realm path validation.
 */
import { describe, it, expect } from 'vitest'
import {
    generateDAOCode,
    buildDeployDAOMsg,
    validateRealmPath,
    isValidGnoAddress,
    DAO_PRESETS,
    type DAOCreationConfig,
} from './daoTemplate'

// ── Helper ──────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DAOCreationConfig> = {}): DAOCreationConfig {
    return {
        name: 'Test DAO',
        description: 'A test DAO',
        realmPath: 'gno.land/r/test/mydao',
        members: [
            { address: 'g1addr1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', power: 3, roles: ['admin'] },
            { address: 'g1addr2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', power: 1, roles: ['member'] },
        ],
        threshold: 51,
        roles: ['admin', 'member'],
        quorum: 0,
        proposalCategories: ['governance'],
        ...overrides,
    }
}

// ── Code Generation ─────────────────────────────────────────────

describe('generateDAOCode', () => {
    it('generates valid package declaration', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toMatch(/^package mydao\n/)
    })

    it('imports chain/runtime', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toContain('"chain/runtime"')
    })

    it('does NOT import std (deprecated)', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).not.toContain('"std"')
    })

    it('includes all members in init()', () => {
        const config = makeConfig()
        const code = generateDAOCode(config)
        expect(code).toContain('g1addr1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        expect(code).toContain('g1addr2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    })

    it('sets correct threshold and quorum', () => {
        const code = generateDAOCode(makeConfig({ threshold: 66, quorum: 50 }))
        expect(code).toContain('threshold         = 66')
        expect(code).toContain('quorum            = 50')
    })

    it('includes role assignments', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toContain('"admin"')
        expect(code).toContain('"member"')
    })

    it('includes proposal categories', () => {
        const config = makeConfig({ proposalCategories: ['governance', 'treasury'] })
        const code = generateDAOCode(config)
        expect(code).toContain('"governance"')
        expect(code).toContain('"treasury"')
    })

    it('uses cur realm parameter (crossing syntax)', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toContain('func Propose(cur realm,')
        expect(code).toContain('func VoteOnProposal(cur realm,')
        expect(code).toContain('func ExecuteProposal(cur realm,')
        expect(code).toContain('func Archive(cur realm)')
        expect(code).toContain('func AssignRole(cur realm,')
        expect(code).toContain('func RemoveRole(cur realm,')
    })

    it('uses runtime.PreviousRealm (not OriginCaller)', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toContain('runtime.PreviousRealm().Address()')
        expect(code).not.toContain('runtime.OriginCaller()')
    })

    it('generates Archive and IsArchived functions', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toContain('func Archive(cur realm)')
        expect(code).toContain('func IsArchived() bool')
    })

    it('includes quorum check in VoteOnProposal', () => {
        const code = generateDAOCode(makeConfig({ quorum: 33 }))
        expect(code).toContain('quorumMet')
    })

    it('includes last-admin protection in RemoveRole', () => {
        const code = generateDAOCode(makeConfig())
        expect(code).toContain('cannot remove the last admin')
    })

    it('extracts package name from realm path', () => {
        const code = generateDAOCode(makeConfig({ realmPath: 'gno.land/r/zooma/super_dao' }))
        expect(code).toMatch(/^package super_dao/)
    })

    it('generates code for enterprise preset (all roles + categories)', () => {
        const config = makeConfig({
            roles: ['admin', 'dev', 'finance', 'ops', 'member'],
            proposalCategories: ['governance', 'treasury', 'membership', 'operations'],
            quorum: 50,
            threshold: 66,
        })
        const code = generateDAOCode(config)
        expect(code).toContain('"admin"')
        expect(code).toContain('"dev"')
        expect(code).toContain('"finance"')
        expect(code).toContain('"ops"')
        expect(code).toContain('"operations"')
        expect(code).toContain('threshold         = 66')
        expect(code).toContain('quorum            = 50')
    })
})

// ── Injection Prevention ────────────────────────────────────────

describe('code injection prevention', () => {
    it('JSON.stringify escapes DAO names with double quotes', () => {
        const code = generateDAOCode(makeConfig({ name: 'My "Evil" DAO' }))
        // JSON.stringify should produce: "My \"Evil\" DAO"
        expect(code).toContain('name              = "My \\"Evil\\" DAO"')
    })

    it('JSON.stringify escapes newlines in name', () => {
        const code = generateDAOCode(makeConfig({ name: 'line1\nline2' }))
        expect(code).toContain('\\n')
        // The generated Gno code should NOT have a raw newline breaking the string
        const nameMatch = code.match(/name\s+=\s+"([^"]*)"/)
        // JSON.stringify handles this — the Gno string literal should be valid
        expect(nameMatch).toBeTruthy()
    })

    it('JSON.stringify escapes backslashes in description', () => {
        const code = generateDAOCode(makeConfig({ description: 'path\\to\\file' }))
        expect(code).toContain('\\\\')
    })

    it('member addresses appear in init() block', () => {
        const code = generateDAOCode(makeConfig({
            members: [{ address: 'g1abcdefghij1234567890abcdefghijklmnopqr', power: 1, roles: ['member'] }],
        }))
        expect(code).toContain('g1abcdefghij1234567890abcdefghijklmnopqr')
    })

    it('REJECTS invalid member addresses (prevents injection)', () => {
        const code = generateDAOCode(makeConfig({
            members: [
                { address: 'g1abcdefghij1234567890abcdefghijklmnopqr', power: 1, roles: ['admin'] },
                { address: 'INVALID"; panic("hacked', power: 1, roles: ['admin'] },
            ],
        }))
        // Valid address should be present
        expect(code).toContain('g1abcdefghij1234567890abcdefghijklmnopqr')
        // Invalid address should NOT appear in generated code
        expect(code).not.toContain('INVALID')
        expect(code).not.toContain('hacked')
    })

    it('filters invalid roles (prevents injection via role names)', () => {
        const code = generateDAOCode(makeConfig({
            roles: ['admin', 'member', 'INVALID-ROLE', '"inject"'],
        }))
        expect(code).toContain('"admin"')
        expect(code).toContain('"member"')
        expect(code).not.toContain('INVALID-ROLE')
        expect(code).not.toContain('inject')
    })

    it('filters invalid categories', () => {
        const code = generateDAOCode(makeConfig({
            proposalCategories: ['governance', 'drop_tables', 'treasury'],
        }))
        expect(code).toContain('"governance"')
        expect(code).toContain('"treasury"')
        // 'drop_tables' is a valid identifier so it passes through — but injection strings don't
        const code2 = generateDAOCode(makeConfig({
            proposalCategories: ['governance', '"; INJECT("', 'treasury'],
        }))
        expect(code2).toContain('"governance"')
        expect(code2).toContain('"treasury"')
        expect(code2).not.toContain('INJECT')
    })

    it('floors and clamps negative power values', () => {
        const code = generateDAOCode(makeConfig({
            members: [{ address: 'g1abcdefghij1234567890abcdefghijklmnopqr', power: -5, roles: ['admin'] }],
        }))
        expect(code).toContain('Power: 0')
    })

    it('floors fractional power values', () => {
        const code = generateDAOCode(makeConfig({
            members: [{ address: 'g1abcdefghij1234567890abcdefghijklmnopqr', power: 2.7, roles: ['admin'] }],
        }))
        expect(code).toContain('Power: 2')
    })
})

// ── isValidGnoAddress ───────────────────────────────────────────

describe('isValidGnoAddress', () => {
    it('accepts valid g1 address (40 chars total)', () => {
        expect(isValidGnoAddress('g1abcdefghij1234567890abcdefghijklmnopqr')).toBe(true)
    })

    it('accepts addresses with only lowercase and digits', () => {
        expect(isValidGnoAddress('g1' + 'a'.repeat(38))).toBe(true)
        expect(isValidGnoAddress('g1' + '0'.repeat(38))).toBe(true)
    })

    it('rejects too-short address', () => {
        expect(isValidGnoAddress('g1short')).toBe(false)
    })

    it('rejects too-long address', () => {
        expect(isValidGnoAddress('g1' + 'a'.repeat(39))).toBe(false)
    })

    it('rejects uppercase characters', () => {
        expect(isValidGnoAddress('g1INVALID1234567890abcdefghijklmnopqr')).toBe(false)
    })

    it('rejects non-g1 prefix', () => {
        expect(isValidGnoAddress('cosmos1validaddr1234567890abcdefghijklm')).toBe(false)
    })

    it('rejects empty string', () => {
        expect(isValidGnoAddress('')).toBe(false)
    })

    it('rejects addresses with special chars', () => {
        expect(isValidGnoAddress('g1addr";panic("hacked")//aaaaaaaaaa')).toBe(false)
    })
})

// ── buildDeployDAOMsg ───────────────────────────────────────────

describe('buildDeployDAOMsg', () => {
    it('builds /vm.m_addpkg message type', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/test/dao', 'package dao\n')
        expect(msg.type).toBe('/vm.m_addpkg')
    })

    it('includes creator address', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/test/dao', 'package dao\n')
        expect(msg.value.creator).toBe('g1caller')
    })

    it('sets package name from last path segment', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/zooma/super_dao', 'pkg')
        const pkg = msg.value.package as { name: string; path: string; files: { name: string; body: string }[] }
        expect(pkg.name).toBe('super_dao')
    })

    it('includes .gno and gnomod.toml files', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/test/dao', 'package dao\n')
        const pkg = msg.value.package as { files: { name: string; body: string }[] }
        const fileNames = pkg.files.map((f) => f.name)
        expect(fileNames).toContain('dao.gno')
        expect(fileNames).toContain('gnomod.toml')
    })

    it('sorts files alphabetically (ValidateBasic requirement)', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/test/zdao', 'package zdao\n')
        const pkg = msg.value.package as { files: { name: string }[] }
        const names = pkg.files.map((f) => f.name)
        // gnomod.toml should come before zdao.gno alphabetically
        expect(names.indexOf('gnomod.toml')).toBeLessThan(names.indexOf('zdao.gno'))
    })

    it('gnomod.toml contains correct module path and gno version', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/test/dao', 'pkg')
        const pkg = msg.value.package as { files: { name: string; body: string }[] }
        const gnomod = pkg.files.find((f) => f.name === 'gnomod.toml')
        expect(gnomod?.body).toContain('module = "gno.land/r/test/dao"')
        expect(gnomod?.body).toContain('gno = "0.9"')
    })

    it('handles empty deposit', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/test/dao', 'pkg')
        expect(msg.value.deposit).toBe('')
    })

    it('passes explicit deposit', () => {
        const msg = buildDeployDAOMsg('g1caller', 'gno.land/r/test/dao', 'pkg', '10000000ugnot')
        expect(msg.value.deposit).toBe('10000000ugnot')
    })
})

// ── validateRealmPath ───────────────────────────────────────────

describe('validateRealmPath', () => {
    it('accepts valid path', () => {
        expect(validateRealmPath('gno.land/r/zooma/mydao')).toBeNull()
    })

    it('accepts path with underscores', () => {
        expect(validateRealmPath('gno.land/r/sam_crew/my_dao')).toBeNull()
    })

    it('rejects path without gno.land/r/ prefix', () => {
        expect(validateRealmPath('cosmos.land/r/test/dao')).toBe('Must start with gno.land/r/')
    })

    it('rejects path without DAO name (only username)', () => {
        const result = validateRealmPath('gno.land/r/zooma')
        expect(result).toContain('namespace and realm name')
    })

    it('rejects uppercase in path', () => {
        const result = validateRealmPath('gno.land/r/zooma/MyDAO')
        expect(result).toContain('lowercase')
    })

    it('rejects DAO name shorter than 3 characters', () => {
        const result = validateRealmPath('gno.land/r/zooma/ab')
        expect(result).toContain('at least 3')
    })

    it('rejects DAO name longer than 30 characters', () => {
        const result = validateRealmPath('gno.land/r/zooma/' + 'a'.repeat(31))
        expect(result).toContain('at most 30')
    })

    it('rejects empty path segments', () => {
        const result = validateRealmPath('gno.land/r//dao')
        expect(result).toContain('cannot be empty')
    })

    it('rejects special characters', () => {
        expect(validateRealmPath('gno.land/r/zooma/my-dao')).not.toBeNull()
        expect(validateRealmPath('gno.land/r/zooma/my.dao')).not.toBeNull()
    })
})

// ── DAO Presets ──────────────────────────────────────────────────

describe('DAO_PRESETS', () => {
    it('has 4 presets', () => {
        expect(DAO_PRESETS).toHaveLength(4)
    })

    it('all presets have required fields', () => {
        for (const preset of DAO_PRESETS) {
            expect(preset.id).toBeTruthy()
            expect(preset.name).toBeTruthy()
            expect(preset.icon).toBeTruthy()
            expect(preset.description).toBeTruthy()
            expect(preset.roles.length).toBeGreaterThan(0)
            expect(preset.threshold).toBeGreaterThan(0)
            expect(preset.categories.length).toBeGreaterThan(0)
        }
    })

    it('basic preset has minimal configuration', () => {
        const basic = DAO_PRESETS.find((p) => p.id === 'basic')!
        expect(basic.roles).toEqual(['admin', 'member'])
        expect(basic.quorum).toBe(0)
        expect(basic.categories).toEqual(['governance'])
    })

    it('enterprise preset has all roles and categories', () => {
        const enterprise = DAO_PRESETS.find((p) => p.id === 'enterprise')!
        expect(enterprise.roles).toEqual(['admin', 'dev', 'finance', 'ops', 'member'])
        expect(enterprise.categories).toEqual(['governance', 'treasury', 'membership', 'operations'])
    })

    it('all presets include admin role', () => {
        for (const preset of DAO_PRESETS) {
            expect(preset.roles).toContain('admin')
        }
    })
})
