import { expect, it } from 'vitest'
import { isProValidatorsRoute } from './proUi'

it('keeps presentation off without the preview flag', () => {
    expect(isProValidatorsRoute('/mainnet/validators', false)).toBe(false)
})
it.each(['/mainnet/validators', '/pearl/validators', '/test13/validators/'])('allows only a known network overview: %s', path => {
    expect(isProValidatorsRoute(path, true)).toBe(true)
})
it.each(['/validators', '/madeup/validators', '/pearl/validators/hacker', '/mainnet/validators/g1address', '/pearl/', '/pearl/dao', '/pearl/settings'])('keeps other surfaces legacy: %s', path => {
    expect(isProValidatorsRoute(path, true)).toBe(false)
})
