import { describe, expect, test } from 'vitest'
import {
    NAV, navForSurface, mobilePrimaryTabs, mobileMoreNav, mobileMoreAccount,
    type NavEntry,
} from './navManifest'

describe('nav manifest', () => {
    test('entry ids are unique', () => {
        const ids = NAV.map((e) => e.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    test('every entry is network-relative and well-formed', () => {
        for (const e of NAV) {
            expect(e.to.startsWith('/'), `${e.id} "to" must start with /`).toBe(true)
            expect(e.label.length, `${e.id} needs a label`).toBeGreaterThan(0)
            expect(typeof e.Icon, `${e.id} needs an Icon`).not.toBe('undefined')
            expect(['primary', 'manage', 'account']).toContain(e.group)
            expect(['both', 'mobile', 'desktop']).toContain(e.showOn)
        }
    })

    test('covers the core primary destinations', () => {
        const tos = NAV.filter((e) => e.group === 'primary').map((e) => e.to)
        for (const route of ['/', '/dao', '/tokens', '/directory', '/validators']) {
            expect(tos, `primary nav must include ${route}`).toContain(route)
        }
    })

    test('navForSurface(desktop) excludes mobile-only entries and vice-versa', () => {
        const desktop = navForSurface('desktop')
        const mobile = navForSurface('mobile')
        expect(desktop.every((e: NavEntry) => e.showOn !== 'mobile')).toBe(true)
        expect(mobile.every((e: NavEntry) => e.showOn !== 'desktop')).toBe(true)
        // 'both' entries appear on each surface
        const both = NAV.filter((e) => e.showOn === 'both')
        for (const e of both) {
            expect(desktop).toContainEqual(e)
            expect(mobile).toContainEqual(e)
        }
    })
})

describe('mobile nav selectors (tab bar source of truth)', () => {
    const ids = (entries: NavEntry[]) => entries.map((e) => e.id)

    test('visitor primary tabs = Home·DAOs·Tokens·Directory (route-mapped)', () => {
        expect(ids(mobilePrimaryTabs(false))).toEqual(['home', 'dao', 'tokens', 'directory'])
    })

    test('member primary tabs swap Directory → Activity (alerts)', () => {
        expect(ids(mobilePrimaryTabs(true))).toEqual(['home', 'dao', 'tokens', 'alerts'])
    })

    test('primary tabs resolve to real manifest entries (route/label/icon)', () => {
        for (const e of [...mobilePrimaryTabs(true), ...mobilePrimaryTabs(false)]) {
            expect(NAV).toContainEqual(e)
            expect(e.to.startsWith('/')).toBe(true)
        }
    })

    test('More→Navigate: visitor sees no auth-gated entries; member gains Dashboard', () => {
        expect(ids(mobileMoreNav(false))).not.toContain('dashboard')
        expect(ids(mobileMoreNav(true))).toContain('dashboard')
        // always-visible overflow nav
        for (const id of ['validators', 'gnolove', 'extensions']) {
            expect(ids(mobileMoreNav(false))).toContain(id)
        }
    })

    test('More→Account: auth-gated profile/settings/multisig only when connected; feedback always', () => {
        expect(ids(mobileMoreAccount(false))).toEqual(['feedback'])
        expect(ids(mobileMoreAccount(true))).toEqual(['profile', 'settings', 'multisig', 'feedback'])
    })
})
