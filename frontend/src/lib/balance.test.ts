/**
 * Unit tests for useBalance — GNOT balance formatting.
 *
 * Tests the pure formatGnot() function which converts ugnot bigint
 * to human-readable "X.YYY GNOT" strings.
 */
import { describe, it, expect } from 'vitest'
import { formatGnot, formatGnotCompact } from '../hooks/useBalance'

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

describe('formatGnotCompact', () => {
    it('formats zero balance', () => {
        expect(formatGnotCompact(0n)).toBe('0 GNOT')
    })

    it('formats whole amounts without decimal', () => {
        expect(formatGnotCompact(1_000_000n)).toBe('1 GNOT')
        expect(formatGnotCompact(19_000_000n)).toBe('19 GNOT')
    })

    it('shows 1 decimal for fractional amounts', () => {
        expect(formatGnotCompact(19_311_863n)).toBe('19.3 GNOT')
        expect(formatGnotCompact(1_500_000n)).toBe('1.5 GNOT')
        expect(formatGnotCompact(1_900_000n)).toBe('1.9 GNOT')
    })

    it('floors the decimal (no rounding up)', () => {
        // 1.99 GNOT → 1.9 (not 2.0)
        expect(formatGnotCompact(1_990_000n)).toBe('1.9 GNOT')
        // 1.050001 GNOT → 0 first decimal = shows as whole
        expect(formatGnotCompact(1_050_001n)).toBe('1 GNOT')
    })

    it('hides decimal when first digit is 0', () => {
        expect(formatGnotCompact(1_001_000n)).toBe('1 GNOT')
        expect(formatGnotCompact(1_000_001n)).toBe('1 GNOT')
    })

    it('handles sub-GNOT amounts', () => {
        expect(formatGnotCompact(500_000n)).toBe('0.5 GNOT')
        expect(formatGnotCompact(100_000n)).toBe('0.1 GNOT')
        expect(formatGnotCompact(1n)).toBe('0 GNOT')
    })

    it('handles large amounts', () => {
        expect(formatGnotCompact(1_000_000_000_000n)).toBe('1000000 GNOT')
    })
})
