import { describe, expect, it } from 'vitest'
import { NOTES_REALM } from './chain/schema'
import { decodeWhitepaperDesk, encodeWhitepaperDesk, planWhitepaperSeed, removeWhitepaperDeskItem, resetWhitepaperDesk, whitepaperItemLabel, type VerifiedWhitepaperRelease, type WhitepaperDeskRules, type WhitepaperDeskItem } from './whitepaperSeed'

const scope = { chainId: 'test-chain', wallet: null }
const rules: WhitepaperDeskRules = { cols: 2, rows: 2, validItem: item => item.ty === 'note' || item.ty === 'app' }
const release: VerifiedWhitepaperRelease = { chainId: scope.chainId, realm: NOTES_REALM, version: 1, noteId: 'ab'.repeat(16), mode: 3, deleted: false }
const pin: WhitepaperDeskItem = { ty: 'app', ref: 'notes', c: 0, r: 0 }
const empty = () => decodeWhitepaperDesk(null, scope, rules)
const seeded = () => planWhitepaperSeed(empty(), scope, rules, release).desk

describe('Whitepaper seed planning without storage or active release', () => {
  it('stays disabled without an explicitly reviewed release', () => {
    expect(planWhitepaperSeed(empty(), scope, rules, null)).toEqual({ desk: empty(), outcome: 'disabled', changed: false })
    expect(whitepaperItemLabel({ ty: 'note', ref: release.noteId }, scope, null)).toBeNull()
  })
  it('migrates legacy arrays losslessly and uses a free cell without mutating input', () => {
    const original = decodeWhitepaperDesk(JSON.stringify([pin]), scope, rules)
    const result = planWhitepaperSeed(original, scope, rules, release)
    expect(result.outcome).toBe('seeded'); expect(result.changed).toBe(true)
    expect(result.desk.items).toEqual([pin, { ty: 'note', ref: release.noteId, c: 0, r: 1 }])
    expect(original.items).toEqual([pin]); expect(original.whitepaper.status).toBe('pending')
    result.desk.items[0].ref = 'changed'; expect(original.items[0].ref).toBe('notes')
  })
  it('roundtrips the scoped envelope and is idempotent, including after a changed release ID', () => {
    const first = seeded(), restored = decodeWhitepaperDesk(encodeWhitepaperDesk(first, scope, rules), scope, rules)
    expect(restored).toEqual(first)
    for (const reviewed of [release, { ...release, noteId: 'cd'.repeat(16) }]) expect(planWhitepaperSeed(restored, scope, rules, reviewed)).toEqual({ desk: first, outcome: 'already-seeded', changed: false })
  })
  it('adopts an existing matching pin without moving it or duplicating it, even in a full desk', () => {
    const pins: WhitepaperDeskItem[] = [{ ty: 'note', ref: release.noteId, c: 1, r: 1 }, pin, { ...pin, ref: 'wallet', r: 1 }, { ...pin, ref: 'feed', c: 1 }]
    const result = planWhitepaperSeed(decodeWhitepaperDesk(JSON.stringify(pins), scope, rules), scope, rules, release)
    expect(result.outcome).toBe('already-seeded'); expect(result.changed).toBe(true); expect(result.desk.items).toEqual(pins)
  })
  it('keeps full desks pending and preserves unrelated removals when space becomes available', () => {
    const pins = Array.from({ length: 4 }, (_, i) => ({ ...pin, ref: `app-${i}`, c: Math.floor(i / 2), r: i % 2 }))
    const full = decodeWhitepaperDesk(JSON.stringify(pins), scope, rules)
    expect(planWhitepaperSeed(full, scope, rules, release)).toEqual({ desk: full, outcome: 'pending-full', changed: false })
    const result = planWhitepaperSeed(removeWhitepaperDeskItem(full, scope, rules, 2), scope, rules, release)
    expect(result.desk.items.at(-1)).toEqual({ ty: 'note', ref: release.noteId, c: 1, r: 0 })
    expect(result.desk.items.slice(0, -1)).toEqual([pins[0], pins[1], pins[3]])
    const duplicates = decodeWhitepaperDesk(JSON.stringify(pins.map(p => ({ ...p, c: 0, r: 0 }))), scope, rules)
    expect(planWhitepaperSeed(duplicates, scope, rules, release).outcome).toBe('pending-full')
  })
  it('preserves dismissal through reload and release changes until explicit reset', () => {
    const dismissed = removeWhitepaperDeskItem(seeded(), scope, rules, 0)
    const restored = decodeWhitepaperDesk(encodeWhitepaperDesk(dismissed, scope, rules), scope, rules)
    expect(restored.whitepaper.status).toBe('dismissed')
    expect(planWhitepaperSeed(restored, scope, rules, { ...release, noteId: 'ef'.repeat(16) }).outcome).toBe('dismissed')
    expect(planWhitepaperSeed(resetWhitepaperDesk(scope, rules, [pin]), scope, rules, release).outcome).toBe('seeded')
    expect(restored.items).toEqual([])
  })
  it('preserves state on unrelated removal and treats a missing seeded pin as dismissed', () => {
    const before = seeded(); before.items.push(pin)
    expect(removeWhitepaperDeskItem(before, scope, rules, 1).whitepaper).toEqual(before.whitepaper)
    before.items = [pin]
    const result = planWhitepaperSeed(before, scope, rules, release)
    expect(result.outcome).toBe('dismissed'); expect(result.desk.items).toEqual([pin])
  })
  it('roundtrips a member partition separately from the guest partition', () => {
    const member = { ...scope, wallet: 'g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l' }
    const desk = decodeWhitepaperDesk(null, member, rules)
    expect(decodeWhitepaperDesk(encodeWhitepaperDesk(desk, member, rules), member, rules).partition).toEqual(member)
    expect(() => decodeWhitepaperDesk(JSON.stringify({ ...desk, whitepaper: { status: 'seeded' } }), member, rules)).toThrow()
  })
  it('rejects crossing chain/wallet partitions, corrupt or oversized records without default fallback', () => {
    const raw = encodeWhitepaperDesk(seeded(), scope, rules)
    for (const other of [{ ...scope, chainId: 'other' }, { ...scope, wallet: 'g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l' }, { ...scope, wallet: 'guest' }]) expect(() => decodeWhitepaperDesk(raw, other, rules)).toThrow()
    for (const bad of ['{broken', 'null', ' '.repeat(65_537)]) expect(() => decodeWhitepaperDesk(bad, scope, rules, [pin])).toThrow()
  })
  it.each([{ chainId: 'wrong' }, { realm: 'gno.land/r/other/notes' }, { version: 2 }, { mode: 0 }, { mode: 1 }, { mode: 2 }, { deleted: true }, { noteId: '00'.repeat(16) }, { noteId: 'AB'.repeat(16) }, { title: 'private title' }])('rejects an unqualified release %j', patch => {
    expect(() => planWhitepaperSeed(empty(), scope, rules, { ...release, ...patch } as VerifiedWhitepaperRelease)).toThrow()
  })
  it('uses a constant label only for the exact configured public note, in modes 3 and 4', () => {
    for (const mode of [3, 4] as const) expect(whitepaperItemLabel({ ty: 'note', ref: release.noteId }, scope, { ...release, mode })).toBe('Whitepaper')
    expect(whitepaperItemLabel({ ty: 'app', ref: release.noteId }, scope, release)).toBeNull()
    expect(whitepaperItemLabel({ ty: 'note', ref: 'cd'.repeat(16) }, scope, release)).toBeNull()
  })
  it('validates schema, routing and bounded grid before planning', () => {
    for (const bad of [{ ...pin, c: 2 }, { ...pin, r: -1 }, { ...pin, ty: 'script' }, { ...pin, title: 'secret' }]) expect(() => decodeWhitepaperDesk(JSON.stringify([bad]), scope, rules)).toThrow()
    expect(() => decodeWhitepaperDesk(JSON.stringify([pin]), scope, { ...rules, validItem: () => false })).toThrow()
    expect(() => planWhitepaperSeed(empty(), scope, { ...rules, validItem: () => false }, release)).toThrow()
    expect(() => decodeWhitepaperDesk(null, scope, { ...rules, rows: 0 })).toThrow()
    expect(() => decodeWhitepaperDesk(null, { ...scope, chainId: 'bad:chain' }, rules)).toThrow()
    expect(() => removeWhitepaperDeskItem(seeded(), scope, rules, 5)).toThrow()
    expect(() => decodeWhitepaperDesk(JSON.stringify({ ...seeded(), version: 2 }), scope, rules)).toThrow()
  })
})
