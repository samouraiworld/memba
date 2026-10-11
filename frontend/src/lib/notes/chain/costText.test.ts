import { expect, it } from 'vitest'
import { approxGnot } from './costText'

it('rounds an expected cost to at most two decimals', () => {
    expect(approxGnot('1153100')).toBe('1.15 GNOT')
    expect(approxGnot('1200000')).toBe('1.2 GNOT')
    expect(approxGnot('3002700')).toBe('3 GNOT')
    expect(approxGnot('4999')).toBe('0 GNOT')
    expect(approxGnot('5000')).toBe('0.01 GNOT')
})
