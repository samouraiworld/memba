import { describe, expect, it } from 'vitest'
import { conflictingLines, mergeLines, mergeNoteText, mergeTitle } from './merge'

const lines = (...values: string[]) => values.join('\n')

describe('line-based three-way merge', () => {
    it('combines disjoint edits from both sides', () => {
        const base = lines('one', 'two', 'three', 'four', 'five')
        const ours = lines('ONE', 'two', 'three', 'four', 'five')
        const theirs = lines('one', 'two', 'three', 'four', 'FIVE')
        expect(mergeLines(base, ours, theirs)).toEqual({ status: 'clean', value: lines('ONE', 'two', 'three', 'four', 'FIVE') })
    })
    it('keeps insertions and deletions that do not touch each other', () => {
        const base = lines('a', 'b', 'c', 'd', 'e')
        expect(mergeLines(base, lines('a', 'inserted', 'b', 'c', 'd', 'e'), lines('a', 'b', 'c', 'e'))).toEqual({ status: 'clean', value: lines('a', 'inserted', 'b', 'c', 'e') })
    })
    it('refuses to merge different edits of the same line', () => {
        const base = lines('one', 'two', 'three')
        expect(mergeLines(base, lines('one', 'mine', 'three'), lines('one', 'theirs', 'three'))).toEqual({ status: 'conflict' })
    })
    it('merges edits of adjacent but different lines', () => {
        const base = lines('one', 'two', 'three')
        expect(mergeLines(base, lines('ONE', 'two', 'three'), lines('one', 'TWO', 'three'))).toEqual({ status: 'clean', value: lines('ONE', 'TWO', 'three') })
        expect(mergeLines(base, lines('two', 'three'), lines('one', 'TWO', 'three'))).toEqual({ status: 'clean', value: lines('TWO', 'three') })
    })
    it('refuses insertions at the same place and insertions at the edge of the other side\'s change', () => {
        const base = lines('one', 'two', 'three')
        expect(mergeLines(base, lines('one', 'two', 'three', 'mine'), lines('one', 'two', 'three', 'theirs'))).toEqual({ status: 'conflict' })
        expect(mergeLines(base, lines('one', 'mine', 'two', 'three'), lines('one', 'TWO', 'three'))).toEqual({ status: 'conflict' })
        expect(mergeLines(base, lines('one', 'two', 'mine', 'three'), lines('one', 'TWO', 'three'))).toEqual({ status: 'conflict' })
        expect(mergeLines(base, lines('one', 'mine', 'two', 'three'), lines('one', 'three'))).toEqual({ status: 'conflict' })
    })
    it('keeps both sides\' lines when a repeated line makes the position ambiguous', () => {
        // Documented limit: with identical neighbouring lines either placement is a valid reading; nothing is lost.
        const result = mergeLines(lines('b', 'c', 'c'), lines('b', 'c', 'X', 'c'), lines('B', 'c', 'c'))
        expect(result.status).toBe('clean')
        if (result.status === 'clean') { expect(result.value.split('\n')).toContain('X'); expect(result.value.split('\n')).toContain('B'); expect(result.value.split('\n')).not.toContain('b') }
    })
    it('accepts identical changes once', () => {
        const base = lines('one', 'two', 'three'), same = lines('one', 'changed', 'three', 'added')
        expect(mergeLines(base, same, same)).toEqual({ status: 'clean', value: same })
        expect(mergeLines(base, lines('one', 'changed', 'three', 'x', 'more'), lines('one', 'changed', 'three'))).toEqual({ status: 'clean', value: lines('one', 'changed', 'three', 'x', 'more') })
    })
    it('takes the only changed side unchanged', () => {
        expect(mergeLines('a\nb\n', 'a\nb\n', 'a\nB\n')).toEqual({ status: 'clean', value: 'a\nB\n' })
        expect(mergeLines('a\nb\n', 'a\nB\nc\n', 'a\nb\n')).toEqual({ status: 'clean', value: 'a\nB\nc\n' })
    })
    it('never guesses without a base: only identical texts merge', () => {
        expect(mergeLines(null, 'same', 'same')).toEqual({ status: 'clean', value: 'same' })
        expect(mergeLines(null, 'mine', 'theirs')).toEqual({ status: 'conflict' })
    })
    it('falls back to a conflict instead of an unbounded comparison', () => {
        const base = Array.from({ length: 3000 }, (_, i) => `line ${i}`)
        const ours = base.map(line => `${line} mine`), theirs = base.map(line => `${line} theirs`)
        expect(mergeLines(base.join('\n'), ours.join('\n'), theirs.join('\n'))).toEqual({ status: 'conflict' })
    })
})

describe('conflicting lines (F25)', () => {
    const base = lines('Sushi', '- milk', '- nori', '- rice')
    it('names our overlapping line by its number in our text, after our earlier non-overlapping changes', () => {
        const ours = lines('Intro', 'Sushi', '- milk', '- nori (B)', '- rice'), theirs = lines('Sushi', '- milk', '- nori (A)', '- rice')
        expect(mergeLines(base, ours, theirs)).toEqual({ status: 'conflict' })
        expect(conflictingLines(base, ours, theirs)).toEqual([{ line: 4, text: '- nori (B)' }])
    })
    it('names a removal by where it was, and nothing when the base is unknown or the edits do not overlap', () => {
        expect(conflictingLines(base, lines('Sushi', '- milk', '- rice'), lines('Sushi', '- milk', '- nori (A)', '- rice'))).toEqual([{ line: 3, text: null }])
        expect(conflictingLines(null, 'mine', 'theirs')).toEqual([])
        expect(conflictingLines(base, lines('Sushi!', '- milk', '- nori', '- rice'), lines('Sushi', '- milk', '- nori', '- rice', '- wasabi'))).toEqual([])
    })
})

describe('title merge', () => {
    it('merges a title changed on one side only', () => {
        expect(mergeTitle('Base', 'Base', 'Theirs')).toEqual({ status: 'clean', value: 'Theirs' })
        expect(mergeTitle('Base', 'Mine', 'Base')).toEqual({ status: 'clean', value: 'Mine' })
        expect(mergeTitle('Base', 'Same', 'Same')).toEqual({ status: 'clean', value: 'Same' })
    })
    it('refuses different title changes and an unknown base', () => {
        expect(mergeTitle('Base', 'Mine', 'Theirs')).toEqual({ status: 'conflict' })
        expect(mergeTitle(null, 'Mine', 'Theirs')).toEqual({ status: 'conflict' })
    })
})

describe('note merge', () => {
    const base = { title: 'Groceries', body: lines('- milk', '- eggs', '- bread') }
    it('merges a title-only change with a body-only change independently', () => {
        const result = mergeNoteText(base, { title: 'Groceries (Sunday)', body: base.body }, { title: base.title, body: lines('- milk', '- eggs', '- bread', '- avocados') })
        expect(result).toEqual({ status: 'clean', title: 'Groceries (Sunday)', body: lines('- milk', '- eggs', '- bread', '- avocados') })
    })
    it('names every conflicting field and never returns merged text for a conflict', () => {
        expect(mergeNoteText(base, { title: 'Mine', body: lines('- milk', '- MINE', '- bread') }, { title: 'Theirs', body: lines('- milk', '- THEIRS', '- bread') }))
            .toEqual({ status: 'conflict', fields: ['title', 'body'] })
        expect(mergeNoteText(base, { title: 'Mine', body: base.body }, { title: 'Theirs', body: lines('- milk') }))
            .toEqual({ status: 'conflict', fields: ['title'] })
    })
    it('handles a redacted or deleted base field', () => {
        expect(mergeNoteText({ title: 'Groceries', body: null }, { title: 'Groceries', body: 'mine' }, { title: 'Groceries', body: 'theirs' }))
            .toEqual({ status: 'conflict', fields: ['body'] })
        expect(mergeNoteText({ title: null, body: null }, { title: 'Same', body: 'same' }, { title: 'Same', body: 'same' }))
            .toEqual({ status: 'clean', title: 'Same', body: 'same' })
    })
})

describe('merge properties', () => {
    /** Small deterministic PRNG so failures reproduce. */
    function prng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 } }
    type Side = 'A' | 'B' | null
    function scenario(random: () => number, round: number) {
        const n = 1 + Math.floor(random() * 12), base = Array.from({ length: n }, (_, i) => `base-${i}`)
        const owner: Side[] = base.map(() => (random() < 0.5 ? null : random() < 0.5 ? 'A' : 'B'))
        const remove = base.map(() => random() < 0.3)
        // Gap p sits before line p; an insertion there must not touch the other side's lines p-1 or p.
        const gap: Side[] = Array.from({ length: n + 1 }, (_, p) => {
            const side: Side = random() < 0.6 ? null : random() < 0.5 ? 'A' : 'B'
            const other = side === 'A' ? 'B' : 'A'
            return side && owner[p - 1] !== other && owner[p] !== other ? side : null
        })
        const render = (side: 'A' | 'B' | 'both') => {
            const out: string[] = []
            for (let p = 0; p <= n; p++) {
                if (gap[p] && (side === 'both' || gap[p] === side)) out.push(`ins-${round}-${gap[p]}-${p}`)
                if (p === n) break
                const mine = owner[p] && (side === 'both' || owner[p] === side)
                if (!mine) out.push(base[p]); else if (!remove[p]) out.push(`mod-${round}-${owner[p]}-${p}`)
            }
            return out.join('\n')
        }
        return { base: base.join('\n'), a: render('A'), b: render('B'), expected: render('both') }
    }
    it('merges random non-touching edits completely, in order and symmetrically', () => {
        const random = prng(20261011)
        for (let round = 0; round < 500; round++) {
            const { base, a, b, expected } = scenario(random, round)
            expect(mergeLines(base, a, b), `round ${round}`).toEqual({ status: 'clean', value: expected })
            expect(mergeLines(base, b, a), `round ${round} swapped`).toEqual({ status: 'clean', value: expected })
        }
    })
})
