import { expect, it } from 'vitest'
import { featuredNoteReleases } from './featuredNoteRelease'

const MAINNET_REALM = 'gno.land/r/samcrew/memba_notes_v1'

it('names exactly the reviewed Sushi note on gnoland-1', () => {
  expect(featuredNoteReleases('gnoland-1', MAINNET_REALM)).toEqual([{ releaseKey: 'sushi-v1', chainId: 'gnoland-1', realm: MAINNET_REALM,
    version: 1, noteId: '4251ea96d68d64737ce7a829f4af22c5', mode: 4, deleted: false, owner: 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c' }])
})
it.each(['gno.land/r/samcrew/memba_notes_rc1', 'gno.land/r/samcrew/memba_notes_v2', '', 'not a realm'])('refuses the gnoland-1 release under realm %j', realm => {
  expect(() => featuredNoteReleases('gnoland-1', realm)).toThrow('format')
})
it.each(['', 'onyx-1', 'test-chain', 'staging', 'mainnet', 'test11', 'gnoland1', 'GNOLAND-1', '__proto__', 'constructor', 'toString'])('has no unreviewed or inherited release for %j', chain => {
  expect(featuredNoteReleases(chain, MAINNET_REALM)).toEqual([])
})
it('returns detached collections without activating another lookup', () => {
  const first = featuredNoteReleases('gnoland-1', MAINNET_REALM)
  const second = featuredNoteReleases('gnoland-1', MAINNET_REALM)
  expect(second).not.toBe(first)
  expect(second[0]).not.toBe(first[0])
  expect(featuredNoteReleases('mainnet', MAINNET_REALM)).not.toBe(featuredNoteReleases('mainnet', MAINNET_REALM))
})
