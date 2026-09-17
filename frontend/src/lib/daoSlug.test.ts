import { describe, it, expect, vi } from 'vitest'
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID } from './config'
import {
    encodeSlug,
    decodeSlug,
    parseDaoSplat,
    validateRealmPath,
    getSavedDAOs,
    getAllSavedDAOs,
    getSavedDAOsForOrg,
    addSavedDAO,
    removeSavedDAO,
    FEATURED_DAO,
} from './daoSlug'

describe('slug encoding', () => {
    it('encodes realm path to URL-safe slug (Phase 2: returns path as-is)', () => {
        expect(encodeSlug('gno.land/r/gov/dao')).toBe('gno.land/r/gov/dao')
    })

    it('decodes legacy ~ encoded slugs', () => {
        expect(decodeSlug('gno.land~r~gov~dao')).toBe('gno.land/r/gov/dao')
    })

    it('decodes slug back to realm path', () => {
        expect(decodeSlug('gno.land~r~gov~dao')).toBe('gno.land/r/gov/dao')
    })

    it('roundtrips encode/decode', () => {
        const path = 'gno.land/r/samcrew/memba_dao'
        expect(decodeSlug(encodeSlug(path))).toBe(path)
    })

    it('blocks path traversal (..) in slug', () => {
        expect(decodeSlug('gno.land~r~..~..~etc~passwd')).toBe('')
    })

    it('blocks non-gno.land paths', () => {
        expect(decodeSlug('evil.com~r~hack')).toBe('')
    })

    it('blocks control characters', () => {
        expect(decodeSlug('gno.land~r~test\x00evil')).toBe('')
    })
})

describe('parseDaoSplat', () => {
    it('parses plain realm path (no sub-route)', () => {
        const r = parseDaoSplat('gno.land/r/gov/dao')
        expect(r.realmPath).toBe('gno.land/r/gov/dao')
        expect(r.subRoute).toBe('')
    })

    it('parses realm path with proposal sub-route', () => {
        const r = parseDaoSplat('gno.land/r/gov/dao/proposal/5')
        expect(r.realmPath).toBe('gno.land/r/gov/dao')
        expect(r.subRoute).toBe('proposal/5')
    })

    it('parses realm path with members sub-route', () => {
        const r = parseDaoSplat('gno.land/r/gov/dao/members')
        expect(r.realmPath).toBe('gno.land/r/gov/dao')
        expect(r.subRoute).toBe('members')
    })

    it('parses the proposals and settings sections', () => {
        expect(parseDaoSplat('gno.land/r/alice/team/proposals')).toEqual({ realmPath: 'gno.land/r/alice/team', subRoute: 'proposals' })
        expect(parseDaoSplat('gno.land/r/alice/team/settings')).toEqual({ realmPath: 'gno.land/r/alice/team', subRoute: 'settings' })
    })

    it('parses treasury/propose nested sub-route', () => {
        const r = parseDaoSplat('gno.land/r/gov/dao/treasury/propose')
        expect(r.realmPath).toBe('gno.land/r/gov/dao')
        expect(r.subRoute).toBe('treasury/propose')
    })

    it('parses channels with channel name', () => {
        const r = parseDaoSplat('gno.land/r/gov/dao/channels/general')
        expect(r.realmPath).toBe('gno.land/r/gov/dao')
        expect(r.subRoute).toBe('channels/general')
    })

    it('parses legacy ~ encoded slug', () => {
        const r = parseDaoSplat('gno.land~r~gov~dao')
        expect(r.realmPath).toBe('gno.land/r/gov/dao')
        expect(r.subRoute).toBe('')
    })

    it('parses legacy ~ slug with sub-route', () => {
        const r = parseDaoSplat('gno.land~r~gov~dao/proposal/3')
        expect(r.realmPath).toBe('gno.land/r/gov/dao')
        expect(r.subRoute).toBe('proposal/3')
    })

    it('returns empty for invalid path', () => {
        const r = parseDaoSplat('invalid/path')
        expect(r.realmPath).toBe('')
    })

    it('returns empty for empty string', () => {
        const r = parseDaoSplat('')
        expect(r.realmPath).toBe('')
    })
})

describe('validateRealmPath', () => {
    it('accepts valid realm path', () => {
        expect(validateRealmPath('gno.land/r/gov/dao')).toBeNull()
    })

    it('accepts realm path with underscores', () => {
        expect(validateRealmPath('gno.land/r/samcrew/memba_dao')).toBeNull()
    })

    it('rejects empty path', () => {
        expect(validateRealmPath('')).toBe('Realm path is required')
    })

    it('rejects path over 100 chars', () => {
        const long = 'gno.land/r/' + 'a'.repeat(91)
        expect(validateRealmPath(long)).toBe('Realm path is too long (max 100 characters)')
    })

    it('rejects path without gno.land/r/ prefix', () => {
        expect(validateRealmPath('cosmos.land/r/test')).toBe('Realm path must start with gno.land/r/')
    })

    it('rejects path traversal', () => {
        expect(validateRealmPath('gno.land/r/../etc/passwd')).toBe('Invalid realm path (path traversal blocked)')
    })
})

describe('localStorage persistence', () => {
    it('returns empty array when no saved DAOs', () => {
        expect(getSavedDAOs()).toEqual([])
    })

    it('saves and retrieves a DAO', () => {
        addSavedDAO('gno.land/r/gov/dao', 'GovDAO')
        const daos = getSavedDAOs()
        expect(daos).toHaveLength(1)
        expect(daos[0].realmPath).toBe('gno.land/r/gov/dao')
        expect(daos[0].name).toBe('GovDAO')
    })

    it('deduplicates by realmPath', () => {
        addSavedDAO('gno.land/r/gov/dao', 'GovDAO')
        addSavedDAO('gno.land/r/gov/dao', 'Updated Name')
        const daos = getSavedDAOs()
        expect(daos).toHaveLength(1)
        expect(daos[0].name).toBe('Updated Name')
    })

    it('removes a saved DAO', () => {
        addSavedDAO('gno.land/r/gov/dao', 'GovDAO')
        addSavedDAO('gno.land/r/test/other', 'Other')
        removeSavedDAO('gno.land/r/gov/dao')
        const daos = getSavedDAOs()
        expect(daos).toHaveLength(1)
        expect(daos[0].realmPath).toBe('gno.land/r/test/other')
    })

    it('rejects invalid realm path in addSavedDAO', () => {
        addSavedDAO('evil.com/r/hack', 'Bad')
        expect(getSavedDAOs()).toEqual([])
    })

    it('handles corrupted localStorage gracefully', () => {
        localStorage.setItem('memba_saved_daos', 'not json')
        expect(getSavedDAOs()).toEqual([])
    })
})

describe('FEATURED_DAO', () => {
    it('has correct default values', () => {
        expect(FEATURED_DAO.realmPath).toBe('gno.land/r/gov/dao')
        expect(FEATURED_DAO.name).toBe('GovDAO')
    })
})

describe('chain scoping', () => {
    const PEARL_ENTRY = { realmPath: 'gno.land/r/alice/dao', name: 'Alice', addedAt: 1, network: 'pearl', chainId: 'pearl-1' }
    const MAINNET_ENTRY = { realmPath: 'gno.land/r/alice/dao', name: 'Alice (mainnet)', addedAt: 2, network: 'mainnet', chainId: 'gnoland-1' }

    it('stamps the loaded network and chain id on a new save, ignoring the storage echo', () => {
        localStorage.setItem('memba_network', 'test13')
        addSavedDAO('gno.land/r/gov/dao', 'GovDAO')
        const saved = getSavedDAOs()[0]
        expect(saved.network).toBe(ACTIVE_NETWORK_KEY)
        expect(saved.chainId).toBe(GNO_CHAIN_ID)
    })

    it('shows only entries saved on the active chain', () => {
        localStorage.setItem('memba_saved_daos', JSON.stringify([PEARL_ENTRY, MAINNET_ENTRY]))
        const visible = getSavedDAOs()
        expect(visible).toHaveLength(1)
        expect(visible[0].chainId).toBe(GNO_CHAIN_ID)
        expect(getAllSavedDAOs()).toHaveLength(2)
    })

    it('a pearl-saved DAO does not appear on mainnet', async () => {
        vi.resetModules()
        vi.doMock('./config', async (orig) => ({ ...(await orig<typeof import('./config')>()), GNO_CHAIN_ID: 'gnoland-1', ACTIVE_NETWORK_KEY: 'mainnet' }))
        try {
            const mainnet = await import('./daoSlug')
            localStorage.setItem('memba_saved_daos', JSON.stringify([PEARL_ENTRY]))
            expect(mainnet.getSavedDAOs()).toEqual([])
            // Saving the same path on mainnet keeps both chains' entries apart.
            mainnet.addSavedDAO('gno.land/r/alice/dao', 'Alice (mainnet)')
            expect(mainnet.getSavedDAOs().map(d => d.name)).toEqual(['Alice (mainnet)'])
            expect(mainnet.getAllSavedDAOs()).toHaveLength(2)
            mainnet.removeSavedDAO('gno.land/r/alice/dao')
            expect(mainnet.getAllSavedDAOs().map(d => d.chainId)).toEqual(['pearl-1'])
        } finally {
            vi.doUnmock('./config')
            vi.resetModules()
        }
    })

    it('migrates only entries tagged with a known network, never rewriting a tag', () => {
        const legacy = [
            { realmPath: 'gno.land/r/legacy/untagged', name: 'Untagged', addedAt: 1 },
            { realmPath: 'gno.land/r/legacy/mainnet', name: 'Mainnet', addedAt: 2, network: 'mainnet' },
            { realmPath: 'gno.land/r/legacy/retired', name: 'Retired', addedAt: 3, network: 'test12' },
        ]
        localStorage.setItem('memba_saved_daos', JSON.stringify(legacy))
        const all = getAllSavedDAOs()
        expect(all.map(d => [d.realmPath, d.network, d.chainId])).toEqual([
            ['gno.land/r/legacy/untagged', undefined, undefined],
            ['gno.land/r/legacy/mainnet', 'mainnet', 'gnoland-1'],
            ['gno.land/r/legacy/retired', 'test12', undefined],
        ])
        // Idempotent: a second read writes the same thing.
        const stored = localStorage.getItem('memba_saved_daos')
        getAllSavedDAOs()
        expect(localStorage.getItem('memba_saved_daos')).toBe(stored)
    })

    it('shows untagged legacy entries as before, and hides entries tagged for an unknown network', () => {
        localStorage.setItem('memba_saved_daos', JSON.stringify([
            { realmPath: 'gno.land/r/legacy/untagged', name: 'Untagged', addedAt: 1 },
            { realmPath: 'gno.land/r/legacy/retired', name: 'Retired', addedAt: 3, network: 'test12' },
        ]))
        const visible = getSavedDAOs()
        expect(visible.map(d => d.realmPath)).toEqual(['gno.land/r/legacy/untagged'])
        expect(visible[0].network).toBeUndefined()
    })

    it('scopes org lists the same way', () => {
        localStorage.setItem('memba_saved_daos_org_o1', JSON.stringify([
            { ...PEARL_ENTRY, orgId: 'o1' }, { ...MAINNET_ENTRY, orgId: 'o1' },
        ]))
        expect(getSavedDAOsForOrg('o1').map(d => d.chainId)).toEqual([GNO_CHAIN_ID])
    })
})
