/**
 * Unit tests for useBalance — GNOT balance formatting.
 *
 * Tests the pure formatGnot() function which converts ugnot bigint
 * to human-readable "X.YYY GNOT" strings.
 */
import { describe, it, expect } from 'vitest'
import { formatGnot } from '../hooks/useBalance'

describe('formatGnot', () => {
    it('formats zero balance', () => {
        expect(formatGnot(0n)).toBe('0 GNOT')
    })

    it('formats whole GNOT amounts', () => {
        expect(formatGnot(1_000_000n)).toBe('1 GNOT')
        expect(formatGnot(10_000_000n)).toBe('10 GNOT')
        expect(formatGnot(100_000_000n)).toBe('100 GNOT')
    })

    it('formats fractional amounts', () => {
        expect(formatGnot(1_500_000n)).toBe('1.5 GNOT')
        expect(formatGnot(1_234_567n)).toBe('1.234567 GNOT')
    })

    it('formats sub-GNOT amounts', () => {
        expect(formatGnot(500_000n)).toBe('0.5 GNOT')
        expect(formatGnot(1n)).toBe('0.000001 GNOT')
        expect(formatGnot(100n)).toBe('0.0001 GNOT')
    })

    it('trims trailing zeros in fractional part', () => {
        expect(formatGnot(1_100_000n)).toBe('1.1 GNOT')
        expect(formatGnot(1_010_000n)).toBe('1.01 GNOT')
        expect(formatGnot(1_001_000n)).toBe('1.001 GNOT')
    })

    it('handles large amounts', () => {
        expect(formatGnot(1_000_000_000_000n)).toBe('1000000 GNOT')
    })
})
