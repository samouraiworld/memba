/**
 * Unit tests for GnoCodeBlock tokenizer — Gno/Go syntax highlighting.
 *
 * Tests the pure tokenize() function which converts Gno source code
 * into colored token spans for the code preview component.
 */
import { describe, it, expect } from 'vitest'
import { tokenize } from './gnoTokenizer'

// ── Keywords ────────────────────────────────────────────────────

describe('tokenize — keywords', () => {
    it('identifies Go/Gno keywords', () => {
        const tokens = tokenize('package main')
        const keywords = tokens.filter(t => t.type === 'keyword')
        expect(keywords.map(t => t.text)).toEqual(['package'])
    })

    it('identifies func keyword', () => {
        const tokens = tokenize('func Render(path string) string {')
        const keywords = tokens.filter(t => t.type === 'keyword')
        expect(keywords.map(t => t.text)).toContain('func')
        // 'string' appears twice but as type, not keyword
        const types = tokens.filter(t => t.type === 'type')
        expect(types.map(t => t.text)).toContain('string')
    })

    it('identifies control flow keywords', () => {
        const tokens = tokenize('if x > 0 { return true } else { return false }')
        const keywords = tokens.filter(t => t.type === 'keyword')
        const kwTexts = keywords.map(t => t.text)
        expect(kwTexts).toContain('if')
        expect(kwTexts).toContain('return')
        expect(kwTexts).toContain('true')
        expect(kwTexts).toContain('else')
        expect(kwTexts).toContain('false')
    })

    it('does not match keywords inside identifiers', () => {
        const tokens = tokenize('varName := 1')
        // "var" should NOT be extracted from "varName"
        const keywords = tokens.filter(t => t.type === 'keyword')
        expect(keywords.map(t => t.text)).not.toContain('var')
    })
})

// ── Strings ─────────────────────────────────────────────────────

describe('tokenize — strings', () => {
    it('identifies double-quoted strings', () => {
        const tokens = tokenize('"hello world"')
        const strings = tokens.filter(t => t.type === 'string')
        expect(strings).toHaveLength(1)
        expect(strings[0].text).toBe('"hello world"')
    })

    it('identifies backtick strings', () => {
        const tokens = tokenize('x := `multi\nline`')
        const strings = tokens.filter(t => t.type === 'string')
        expect(strings).toHaveLength(1)
        expect(strings[0].text).toBe('`multi\nline`')
    })

    it('handles escaped quotes in strings', () => {
        const tokens = tokenize('"say \\"hello\\""')
        const strings = tokens.filter(t => t.type === 'string')
        expect(strings).toHaveLength(1)
        expect(strings[0].text).toBe('"say \\"hello\\""')
    })
})

// ── Comments ────────────────────────────────────────────────────

describe('tokenize — comments', () => {
    it('identifies line comments', () => {
        const tokens = tokenize('x := 1 // this is a comment')
        const comments = tokens.filter(t => t.type === 'comment')
        expect(comments).toHaveLength(1)
        expect(comments[0].text).toBe('// this is a comment')
    })

    it('comments take priority over keywords', () => {
        const tokens = tokenize('// func package import')
        // Everything should be a single comment, not individual keywords
        const comments = tokens.filter(t => t.type === 'comment')
        expect(comments).toHaveLength(1)
        const keywords = tokens.filter(t => t.type === 'keyword')
        expect(keywords).toHaveLength(0)
    })
})

// ── Types ────────────────────────────────────────────────────────

describe('tokenize — types', () => {
    it('identifies built-in types', () => {
        const tokens = tokenize('var x string')
        const types = tokens.filter(t => t.type === 'type')
        expect(types.map(t => t.text)).toContain('string')
    })

    it('identifies custom types (capitalized identifiers)', () => {
        const tokens = tokenize('var d *Dao')
        const customTypes = tokens.filter(t => t.type === 'customType')
        expect(customTypes.map(t => t.text)).toContain('Dao')
    })
})

// ── Numbers ─────────────────────────────────────────────────────

describe('tokenize — numbers', () => {
    it('identifies integer literals', () => {
        const tokens = tokenize('x := 42')
        const numbers = tokens.filter(t => t.type === 'number')
        expect(numbers.map(t => t.text)).toContain('42')
    })

    it('identifies float literals', () => {
        const tokens = tokenize('y := 3.14')
        const numbers = tokens.filter(t => t.type === 'number')
        expect(numbers.map(t => t.text)).toContain('3.14')
    })
})

// ── Full snippet ────────────────────────────────────────────────

describe('tokenize — full Gno snippet', () => {
    it('tokenizes a complete package declaration', () => {
        const code = `package main

import "std"

// Render returns the DAO page
func Render(path string) string {
    return "Hello"
}`
        const tokens = tokenize(code)
        // Should have tokens for all categories
        const types = new Set(tokens.map(t => t.type))
        expect(types.has('keyword')).toBe(true)
        expect(types.has('string')).toBe(true)
        expect(types.has('comment')).toBe(true)
        expect(types.has('plain')).toBe(true)
    })

    it('preserves all original text (no data loss)', () => {
        const code = 'func main() { return 42 }'
        const tokens = tokenize(code)
        const reconstructed = tokens.map(t => t.text).join('')
        expect(reconstructed).toBe(code)
    })

    it('handles empty input', () => {
        const tokens = tokenize('')
        expect(tokens).toHaveLength(0)
    })
})
