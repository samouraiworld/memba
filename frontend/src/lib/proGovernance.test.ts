import { expect, it } from 'vitest'
import { isProGovernanceRoute } from './proGovernance'
const dao = '/mainnet/dao/gno.land/r/gov/dao'
it('defaults the presentation off', () => expect(isProGovernanceRoute(dao, false)).toBe(false))
it.each([dao, `${dao}/`, `${dao}/proposal/0`, '/pearl/dao/gno.land/r/team/dao/proposal/32/'])('allows a known network reader: %s', path => expect(isProGovernanceRoute(path, true)).toBe(true))
it.each(['', '/dao/gno.land/r/gov/dao', '/unknown/dao/gno.land/r/gov/dao', '/pearl/dao/create', '/pearl/dao/gno.land~r~gov~dao', `${dao}/propose`, `${dao}/members`, `${dao}/treasury`, `${dao}/treasury/propose`, `${dao}/channels`, `${dao}/plugin/board`, `${dao}/proposal/abc`, `${dao}/proposal/1/execute`, `${dao}/proposal/-1`, '/mainnet/validators'])('excludes every other surface: %s', path => expect(isProGovernanceRoute(path, true)).toBe(false))
