import { describe, expect, it } from 'vitest'
import { bech32Encode } from '../dao/realmAddress'
import { NOTES_REALM } from './chain/schema'
import { decodeFeaturedDesk, encodeFeaturedDesk, featuredNoteLabel, planFeaturedNoteSeeds, removeFeaturedDeskItem, resetFeaturedDesk, validateFeaturedRelease, type FeaturedDeskItem, type FeaturedDeskRules, type FeaturedNoteRelease } from './featuredNoteSeed'

const scope = { chainId: 'test-chain', wallet: null }
const rules: FeaturedDeskRules = { cols: 2, rows: 2, validItem: item => item.ty === 'note' || item.ty === 'app' }
const owner = bech32Encode('g', new Uint8Array(20).fill(1))
const sushi: FeaturedNoteRelease = { releaseKey: 'sushi-v1', chainId: scope.chainId, realm: NOTES_REALM, version: 1, noteId: 'ab'.repeat(16), owner, mode: 4, deleted: false }
const paper: FeaturedNoteRelease = { ...sushi, releaseKey: 'whitepaper-v1', noteId: 'cd'.repeat(16) }
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
  it('does not transfer a recipe dismissal to Whitepaper or remove another icon', () => {
    const seeded = planFeaturedNoteSeeds(empty(), scope, rules, [sushi]).desk
    const dismissed = removeFeaturedDeskItem(seeded, scope, rules, 0)
    const next = planFeaturedNoteSeeds(dismissed, scope, rules, [sushi, paper])
    expect(next.outcomes).toEqual({ 'sushi-v1': 'dismissed', 'whitepaper-v1': 'seeded' })
    expect(next.desk.items.map(i => i.ref)).toEqual([paper.noteId])
    expect(planFeaturedNoteSeeds(next.desk, scope, rules, []).desk).toEqual(next.desk)
    expect(planFeaturedNoteSeeds(resetFeaturedDesk(scope, rules), scope, rules, [paper]).desk.items).toHaveLength(1)
  })
  it('keeps sushi and its location when Whitepaper is later released', () => {
    const first = planFeaturedNoteSeeds(empty(), scope, rules, [sushi]).desk
    const next = planFeaturedNoteSeeds(first, scope, rules, [paper]).desk
    expect(next.items[0]).toEqual(first.items[0]); expect(next.items.map(i => i.ref)).toEqual([sushi.noteId, paper.noteId])
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
    expect(() => planFeaturedNoteSeeds(seeded, scope, rules, [{ ...sushi, noteId: paper.noteId }])).toThrow()
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
  it('rejects duplicate releases, shared targets, invalid public identity and cross-network release', () => {
    expect(() => planFeaturedNoteSeeds(empty(), scope, rules, [sushi, sushi])).toThrow()
    expect(() => planFeaturedNoteSeeds(empty(), scope, rules, [sushi, { ...paper, noteId: sushi.noteId }])).toThrow()
    for (const patch of [{ mode: 3 }, { deleted: true }, { realm: 'other' }, { owner: 'not-address' }, { chainId: 'other' }, { noteId: '0'.repeat(32) }, { releaseKey: '__proto__' }]) {
      expect(() => validateFeaturedRelease({ ...sushi, ...patch }, scope.chainId)).toThrow()
    }
  })
  it('rejects collision with a stored release omitted from current rollout', () => {
    const seeded = planFeaturedNoteSeeds(empty(), scope, rules, [sushi]).desk
    expect(() => planFeaturedNoteSeeds(seeded, scope, rules, [{ ...paper, noteId: sushi.noteId }])).toThrow()
    const corrupt = { ...seeded, releases: { ...seeded.releases, 'whitepaper-v1': { status: 'seeded', noteId: sushi.noteId } } }
    expect(() => decodeFeaturedDesk(JSON.stringify(corrupt), scope, rules)).toThrow()
  })
  it('decodes only bounded exact partitions and closed ledger fields', () => {
    const raw = encodeFeaturedDesk(empty(), scope, rules)
    expect(decodeFeaturedDesk(raw, scope, rules)).toEqual(empty())
    for (const value of [
      { ...empty(), version: 2 }, { ...empty(), partition: { ...scope, chainId: 'other' } },
      { ...empty(), partition: { ...scope, wallet: owner } }, { ...empty(), extra: true },
      { ...empty(), releases: { 'sushi-v1': { status: 'pending' } } },
      { ...empty(), releases: { ...empty().releases, 'sushi-v1': { status: 'dismissed', noteId: sushi.noteId } } },
      { ...empty(), items: [{ ...app, c: 5 }] },
    ]) expect(() => decodeFeaturedDesk(JSON.stringify(value), scope, rules)).toThrow()
    expect(() => decodeFeaturedDesk(' '.repeat(65537), scope, rules)).toThrow()
  })
  it('labels are fixed per purpose, never an arbitrary note title', () => {
    expect(featuredNoteLabel('sushi-v1')).toBe('Sushi recipe'); expect(featuredNoteLabel('whitepaper-v1')).toBe('Whitepaper')
  })
})
