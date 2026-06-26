import { describe, expect, test } from 'vitest'
import { NAV, navForSurface, type NavEntry } from './navManifest'

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
