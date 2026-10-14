import { describe, expect, it } from 'vitest'
import { publicBodyProblem, publicTitleProblem, trimPublicTitle, copyTitle } from './publicFields'
import { publicText } from './chain/schema'

const accepted = (title: string) => { try { publicText(new TextEncoder().encode(title), true); return true } catch { return false } }

describe('public title rules mirror the realm validateTitle', () => {
    it('trims Go strings.TrimSpace whitespace at both ends, including Unicode spaces, and nothing inside', () => {
        expect(trimPublicTitle('  Sushi recipe \t')).toBe('Sushi recipe')
        expect(trimPublicTitle(' 　Sushi recipe \u0085')).toBe('Sushi recipe')
        expect(trimPublicTitle('Sushi  recipe')).toBe('Sushi  recipe')
    })
    it.each([
        ['', /Add a title/],
        ['   ', /Add a title/],
        ['a'.repeat(81), /80 characters/],
        ['é'.repeat(80) + 'aa', /80 characters/],
        ['😀'.repeat(41), /160 bytes/],
        ['Recipes/sushi', /“\/”/],
        ['Line\nbreak', /line breaks, tabs or other control characters/],
        ['Tab\there', /line breaks, tabs or other control characters/],
        ['Del\u007fete', /control characters/],
        ['Zero​width', /invisible formatting characters/],
        ['Bidi‮override', /invisible formatting characters/],
        ['Lone \ud800 surrogate', /unsupported character/],
    ])('explains why %j is refused', (title, message) => {
        expect(publicTitleProblem(title)).toMatch(message)
    })
    it.each(['Sushi', 'é'.repeat(80), '😀'.repeat(40), 'Sushi recipe', 'Notes: v1 — draft', '  Trimmed  '])('accepts %j once trimmed', title => {
        expect(publicTitleProblem(title)).toBeNull()
    })
    it.each(['Sushi', ' Sushi', 'Sushi ', '', 'a/b', 'x​', 'x\u0085', 'é'.repeat(80), '😀'.repeat(41), 'a'.repeat(80), 'a'.repeat(81), 'A B', ' ', 'Tab\t'])(
        'agrees with the chain codec guard after trimming for %j', title => {
            expect(publicTitleProblem(title) === null).toBe(accepted(trimPublicTitle(title)))
        })
})

describe('a separate copy is told apart from its note (F26)', () => {
    it('suffixes the title and keeps it publishable', () => {
        expect(copyTitle('Sushi (rc1 canary)')).toBe('Sushi (rc1 canary) (my version)')
        expect(copyTitle('  ')).toBe('Untitled note (my version)')
        const long = copyTitle('é'.repeat(80))
        expect(long.endsWith(' (my version)')).toBe(true); expect(publicTitleProblem(long)).toBeNull()
        // 40 four-byte emoji: 40 characters but already 160 bytes, the byte limit decides.
        const emoji = copyTitle('🍣'.repeat(40))
        expect(emoji).toBe(`${'🍣'.repeat(36)} (my version)`); expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(160); expect(publicTitleProblem(emoji)).toBeNull()
    })
})
describe('public body rules mirror the realm validatePublic', () => {
    it('accepts an empty body and exactly 128 KiB, refuses one byte more and unpaired surrogates', () => {
        expect(publicBodyProblem('')).toBeNull()
        expect(publicBodyProblem('a'.repeat(131072))).toBeNull()
        expect(publicBodyProblem('a'.repeat(131071) + 'é')).toMatch(/128 KiB/)
        expect(publicBodyProblem('text \udc00')).toMatch(/unsupported character/)
    })
})
