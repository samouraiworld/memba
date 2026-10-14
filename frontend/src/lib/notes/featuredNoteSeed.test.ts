import { describe, expect, it } from 'vitest'
import { bech32Encode } from '../dao/realmAddress'
import { NOTES_REALM } from './chain/schema'
import { decodeFeaturedDesk, encodeFeaturedDesk, featuredNoteLabel, planFeaturedNoteSeeds, removeFeaturedDeskItem, resetFeaturedDesk, validateFeaturedRelease, type FeaturedDeskItem, type FeaturedDeskRules, type FeaturedNoteRelease, type FeaturedReleaseKey } from './featuredNoteSeed'

const scope = { chainId: 'test-chain', wallet: null }
const rules: FeaturedDeskRules = { cols: 2, rows: 2, validItem: item => item.ty === 'note' || item.ty === 'app' }
const owner = bech32Encode('g', new Uint8Array(20).fill(1))
const sushi: FeaturedNoteRelease = { releaseKey: 'sushi-v1', chainId: scope.chainId, realm: NOTES_REALM, version: 1, noteId: 'ab'.repeat(16), owner, mode: 4, deleted: false }
const other = 'cd'.repeat(16)
const app: FeaturedDeskItem = { ty: 'app', ref: 'wallet', c: 0, r: 0 }
const empty = () => resetFeaturedDesk(scope, rules)

describe('independent immutable featured document seeds', () => {
  it('seeds a free cell once, preserves positions and never mutates its input', () => {
    const before = resetFeaturedDesk(scope, rules, [app])
    const first = planFeaturedNoteSeeds(before, scope, rules, [sushi])
    expect(first.desk.items).toEqual([app, { ty: 'note', ref: sushi.noteId, c: 0, r: 1 }])
    expect(before.items).toEqual([app]); expect(first.changed).toBe(true)
    first.desk.items[1].c = 1
    const again = planFeaturedNoteSeeds(first.desk, scope, rules, [sushi])
    expect(again.desk).toEqual(first.desk); expect(again.changed).toBe(false)
  })
  it('adopts a manually pinned target without duplication and preserves unrelated removals', () => {
    const manual: FeaturedDeskItem = { ty: 'note', ref: sushi.noteId, c: 1, r: 1 }
    const first = planFeaturedNoteSeeds(resetFeaturedDesk(scope, rules, [app, manual]), scope, rules, [sushi])
    expect(first.outcomes['sushi-v1']).toBe('already-seeded')
    const next = removeFeaturedDeskItem(first.desk, scope, rules, 0)
    expect(next.items).toEqual([manual]); expect(next.releases['sushi-v1'].status).toBe('seeded')
  })
  it('treats a missing previously seeded icon as dismissal and rejects retargeting', () => {
    const seeded = planFeaturedNoteSeeds(empty(), scope, rules, [sushi]).desk
    expect(() => planFeaturedNoteSeeds(seeded, scope, rules, [{ ...sushi, noteId: other }])).toThrow()
    seeded.items = []
    expect(planFeaturedNoteSeeds(seeded, scope, rules, [sushi]).outcomes['sushi-v1']).toBe('dismissed')
  })
  it('leaves full desks pending without truncating and retries after space is freed', () => {
    const items = [0, 1, 2, 3].map(n => ({ ...app, ref: `app-${n}`, c: n % 2, r: Math.floor(n / 2) }))
    const first = planFeaturedNoteSeeds(resetFeaturedDesk(scope, rules, items), scope, rules, [sushi])
    expect(first.changed).toBe(false); expect(first.desk.items).toEqual(items)
    expect(first.outcomes['sushi-v1']).toBe('pending-full')
    expect(planFeaturedNoteSeeds(removeFeaturedDeskItem(first.desk, scope, rules, 2), scope, rules, [sushi]).outcomes['sushi-v1']).toBe('seeded')
  })
  it('rejects duplicate releases, retired or unknown keys, invalid public identity and cross-network release', () => {
    expect(() => planFeaturedNoteSeeds(empty(), scope, rules, [sushi, sushi])).toThrow()
    for (const patch of [{ mode: 3 }, { deleted: true }, { realm: 'other' }, { owner: 'not-address' }, { chainId: 'other' }, { noteId: '0'.repeat(32) }, { releaseKey: '__proto__' }, { releaseKey: 'whitepaper-v1' }]) {
      expect(() => validateFeaturedRelease({ ...sushi, ...patch }, scope.chainId)).toThrow()
    }
  })
  it('accepts a stored retired release entry, keeps every item and drops the entry on write', () => {
    const items = [app, { ty: 'note', ref: other, c: 1, r: 0 } as FeaturedDeskItem]
    for (const retired of [{ status: 'seeded', noteId: other }, { status: 'seeded', noteId: sushi.noteId }, { status: 'dismissed' }, { status: 'pending' }, { bogus: true }]) {
      const stored = { version: 3, partition: scope, items, releases: { 'sushi-v1': { status: 'seeded', noteId: sushi.noteId }, 'whitepaper-v1': retired } }
      const desk = decodeFeaturedDesk(JSON.stringify(stored), scope, rules)
      expect(desk).toEqual({ version: 3, partition: scope, items, releases: { 'sushi-v1': { status: 'seeded', noteId: sushi.noteId } } })
      expect(JSON.parse(encodeFeaturedDesk(desk, scope, rules)).releases).toEqual({ 'sushi-v1': { status: 'seeded', noteId: sushi.noteId } })
    }
    // The leftover note is an ordinary shortcut: removing it never touches the Sushi state.
    const stored = { version: 3, partition: scope, items, releases: { 'sushi-v1': { status: 'pending' }, 'whitepaper-v1': { status: 'seeded', noteId: other } } }
    const next = removeFeaturedDeskItem(decodeFeaturedDesk(JSON.stringify(stored), scope, rules), scope, rules, 1)
    expect(next.items).toEqual([app]); expect(next.releases).toEqual({ 'sushi-v1': { status: 'pending' } })
  })
  it('decodes only bounded exact partitions and closed ledger fields', () => {
    const raw = encodeFeaturedDesk(empty(), scope, rules)
    expect(decodeFeaturedDesk(raw, scope, rules)).toEqual(empty())
    for (const value of [
      { ...empty(), version: 2 }, { ...empty(), partition: { ...scope, chainId: 'other' } },
      { ...empty(), partition: { ...scope, wallet: owner } }, { ...empty(), extra: true },
      { ...empty(), releases: {} }, { ...empty(), releases: { ...empty().releases, 'other-v1': { status: 'pending' } } },
      { ...empty(), releases: { ...empty().releases, 'sushi-v1': { status: 'dismissed', noteId: sushi.noteId } } },
      { ...empty(), items: [{ ...app, c: 5 }] },
    ]) expect(() => decodeFeaturedDesk(JSON.stringify(value), scope, rules)).toThrow()
    expect(() => decodeFeaturedDesk(' '.repeat(65537), scope, rules)).toThrow()
  })
  it('labels are fixed per purpose, never an arbitrary note title', () => {
    expect(featuredNoteLabel('sushi-v1')).toBe('Sushi recipe')
    expect(() => featuredNoteLabel('whitepaper-v1' as FeaturedReleaseKey)).toThrow()
  })
})
