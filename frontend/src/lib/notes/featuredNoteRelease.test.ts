import { expect, it } from 'vitest'
import { featuredNoteReleases } from './featuredNoteRelease'

it.each(['', 'test-chain', 'staging', 'mainnet', 'test11', '__proto__', 'constructor', 'toString'])('has no unreviewed or inherited release for %s', chain => {
  expect(featuredNoteReleases(chain)).toEqual([])
})
it('returns detached empty collections without activating another lookup', () => {
  const first = featuredNoteReleases('mainnet')
  expect(featuredNoteReleases('mainnet')).not.toBe(first)
})
