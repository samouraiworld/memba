// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'notes-history.css'), 'utf8')

describe('notes-history.css: the phone Share menu', () => {
    // A browser without dvh (Safari < 15.4, Chrome < 108, Firefox < 101) drops a dvh declaration whole: without a vh line
    // before it, the fixed menu would be unbounded.
    it.each([['max-height', /\.os-notes-share-pop \{[^}]*\}/], ['min-height', /\.os-notes-app:has\(\.os-notes-share-pop:not\(\[hidden\]\)\) \{[^}]*\}/]])('every dvh %s has a vh fallback just before it', (property, rule) => {
        const block = css.match(new RegExp(rule.source, 'g'))?.find(text => text.includes('dvh'))
        expect(block).toBeDefined()
        const values = [...block!.matchAll(new RegExp(`${property}:([^;]+);`, 'g'))].map(match => match[1])
        expect(values).toHaveLength(2)
        expect(values[0]).toContain('100vh'); expect(values[0]).not.toContain('dvh')
        expect(values[1]).toBe(values[0].replace('100vh', '100dvh'))
    })
})
