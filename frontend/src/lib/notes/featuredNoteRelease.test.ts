import { expect, it } from 'vitest'
import { featuredNoteReleases } from './featuredNoteRelease'

it.each(['', 'test-chain', 'staging', 'mainnet', 'test11', '__proto__', 'constructor', 'toString'])('has no unreviewed or inherited release for %s', chain => {
  expect(featuredNoteReleases(chain, 'gno.land/r/samcrew/memba_notes_v1')).toEqual([])
})
it('returns detached empty collections without activating another lookup', () => {
  const first = featuredNoteReleases('mainnet', 'gno.land/r/samcrew/memba_notes_v1')
  expect(featuredNoteReleases('mainnet', 'gno.land/r/samcrew/memba_notes_v1')).not.toBe(first)
})
