import { describe, it, expect } from 'vitest'
import { NAV } from './navManifest'
import { PRO_NAV_GROUPS, PRO_PRIMARY_IDS, proEntries, proRouteActive } from './proNavigation'

describe('professional presentation preserves the navigation contract', () => {
    it('maps every live entry exactly once; retired dashboard is deliberately omitted', () => {
        const ids = ['home', ...PRO_NAV_GROUPS.flatMap(g => [...g.ids])]
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.toSorted()).toEqual(NAV.filter(e => e.id !== 'dashboard').map(e => e.id).toSorted())
    })
    it('has four public primary destinations and preserves member/admin gates', () => {
        expect(proEntries(PRO_PRIMARY_IDS, false)).toHaveLength(4)
        const ids = PRO_NAV_GROUPS.flatMap(g => [...g.ids])
        expect(proEntries(ids, false).every(e => !e.requiresAuth)).toBe(true)
        expect(proEntries(ids, true).some(e => e.id === 'quest-admin')).toBe(false)
        expect(proEntries(ids, true, true).some(e => e.id === 'quest-admin')).toBe(true)
        expect(proEntries(ids, true).find(e => e.id === 'profile')).toBe(NAV.find(e => e.id === 'profile'))
    })
    it('matches network and path boundaries, including home without a trailing slash', () => {
        expect(proRouteActive('/mainnet', 'mainnet', '/')).toBe(true)
        expect(proRouteActive('/mainnet/validators/hacker', 'mainnet', '/validators')).toBe(true)
        expect(proRouteActive('/mainnet/validators-extra', 'mainnet', '/validators')).toBe(false)
        expect(proRouteActive('/pearl/validators', 'mainnet', '/validators')).toBe(false)
        expect(proRouteActive('/mainnet/dao/x', 'mainnet', '/')).toBe(false)
    })
})
