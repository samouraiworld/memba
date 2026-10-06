import { expect, it } from 'vitest'
import { isProValidatorsRoute } from './proUi'

it('keeps presentation off without the preview flag', () => {
    expect(isProValidatorsRoute('/mainnet/validators', false)).toBe(false)
})
it.each(['/mainnet/validators', '/onyx/validators', '/test13/validators/'])('allows only a known network overview: %s', path => {
    expect(isProValidatorsRoute(path, true)).toBe(true)
})
// A retired network (pearl) is no registry network: its links are redirected, never rendered.
it.each(['/validators', '/madeup/validators', '/pearl/validators', '/onyx/validators/hacker', '/mainnet/validators/g1address', '/onyx/', '/onyx/dao', '/onyx/settings'])('keeps other surfaces legacy: %s', path => {
    expect(isProValidatorsRoute(path, true)).toBe(false)
})
