import { describe, it, expect } from 'vitest'
import {
    encodeSlug,
    decodeSlug,
    validateRealmPath,
    getSavedDAOs,
    addSavedDAO,
    removeSavedDAO,
    FEATURED_DAO,
} from './daoSlug'

describe('slug encoding', () => {
    it('encodes realm path to URL-safe slug', () => {
        expect(encodeSlug('gno.land/r/gov/dao')).toBe('gno.land~r~gov~dao')
    })

    it('decodes slug back to realm path', () => {
        expect(decodeSlug('gno.land~r~gov~dao')).toBe('gno.land/r/gov/dao')
    })

    it('roundtrips encode/decode', () => {
        const path = 'gno.land/r/samcrew/samourai_dao'
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

describe('validateRealmPath', () => {
    it('accepts valid realm path', () => {
        expect(validateRealmPath('gno.land/r/gov/dao')).toBeNull()
    })

    it('accepts realm path with underscores', () => {
        expect(validateRealmPath('gno.land/r/samcrew/samourai_dao')).toBeNull()
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
