import { describe, expect, it, vi } from 'vitest'
import { createFeaturedNoteStorage, type FeaturedLocks, type FeaturedStorageOptions } from './featuredNoteStorage'
import { planFeaturedNoteSeeds, removeFeaturedDeskItem, resetFeaturedDesk, type FeaturedDesk, type FeaturedDeskItem, type FeaturedDeskRules, type FeaturedNoteRelease } from './featuredNoteSeed'
import { NOTES_REALM } from './chain/schema'
import { bech32Encode } from '../dao/realmAddress'

const scope = { chainId: 'test-chain', wallet: null }
const rules: FeaturedDeskRules = { cols: 2, rows: 2, validItem: item => item.ty === 'app' || item.ty === 'note' }
const pin: FeaturedDeskItem = { ty: 'app', ref: 'wallet', c: 0, r: 0 }
const sushi: FeaturedNoteRelease = { releaseKey: 'sushi-v1', chainId: scope.chainId, realm: NOTES_REALM, version: 1, noteId: 'ab'.repeat(16), mode: 4, deleted: false, owner: bech32Encode('g', new Uint8Array(20).fill(1)) }
const paper: FeaturedNoteRelease = { ...sushi, releaseKey: 'whitepaper-v1', noteId: 'cd'.repeat(16) }
const v2Key = 'memba_os_desk:v2:test-chain:guest'
const empty = () => resetFeaturedDesk(scope, rules)
const append = (item: FeaturedDeskItem) => (desk: FeaturedDesk): FeaturedDesk => ({ ...desk, items: [...desk.items, item] })
function locks(): FeaturedLocks {
  const tails = new Map<string, Promise<unknown>>()
  return { request: <T,>(name: string, options: { mode: 'exclusive' }, run: () => T | Promise<T>): Promise<T> => {
    expect(options.mode).toBe('exclusive')
    const result = (tails.get(name) ?? Promise.resolve()).then(run)
    tails.set(name, result.catch(() => {})); return result
  } }
}
function setup(overrides: Partial<FeaturedStorageOptions> = {}) {
  const values = new Map<string, string>(), oldKey = 'memba_os_desk:testnet:guest'
  const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) }
  const readLegacy = vi.fn(() => values.get(oldKey) ?? null)
  const options: FeaturedStorageOptions = { scope, rules, storage, readLegacy, locks: locks(), isCurrent: () => true, ...overrides }
  return { values, oldKey, storage, readLegacy, options, adapter: createFeaturedNoteStorage(options) }
}
const old = (whitepaper: unknown, items: FeaturedDeskItem[] = []) => JSON.stringify({ version: 2, partition: scope, items, whitepaper })

describe('version3 featured desk migration and transaction boundaries', () => {
  it('peeks without writes and imports exact legacy once without deleting its key', async () => {
    const f = setup(), legacy = JSON.stringify([pin]); f.values.set(f.oldKey, legacy)
    expect(f.adapter.key).toBe('memba_os_desk:v3:test-chain:guest')
    expect(f.adapter.peek().items).toEqual([pin]); expect(f.storage.setItem).not.toHaveBeenCalled()
    await f.adapter.mutate(desk => desk)
    expect(f.values.get(f.oldKey)).toBe(legacy)
    f.values.set(f.oldKey, 'bad rewrite'); f.readLegacy.mockClear()
    expect(f.adapter.peek().items).toEqual([pin]); expect(f.readLegacy).not.toHaveBeenCalled()
  })
  it.each([{ status: 'pending' }, { status: 'dismissed' }, { status: 'seeded', noteId: paper.noteId }])('imports old Whitepaper marker only into Whitepaper: %j', async marker => {
    const f = setup(), items: FeaturedDeskItem[] = marker.status === 'seeded' ? [{ ty: 'note', ref: paper.noteId, c: 1, r: 1 }] : [pin]
    const previous = old(marker, items); f.values.set(v2Key, previous); f.values.set(f.oldKey, '{bad')
    const desk = await f.adapter.mutate(d => d)
    expect(desk.releases).toEqual({ 'sushi-v1': { status: 'pending' }, 'whitepaper-v1': marker })
    expect(desk.items).toEqual(items); expect(f.readLegacy).not.toHaveBeenCalled(); expect(f.values.get(v2Key)).toBe(previous)
  })
  it('preserves Whitepaper dismissal while seeding and dismissing sushi independently', async () => {
    const f = setup(); f.values.set(v2Key, old({ status: 'dismissed' }))
    const seed = (d: FeaturedDesk) => planFeaturedNoteSeeds(d, scope, rules, [sushi, paper]).desk
    await f.adapter.mutate(seed); expect(f.adapter.peek().items.map(i => i.ref)).toEqual([sushi.noteId])
    await f.adapter.mutate(d => removeFeaturedDeskItem(d, scope, rules, 0))
    f.values.set(v2Key, old({ status: 'pending' })); f.values.set(f.oldKey, JSON.stringify([pin]))
    await createFeaturedNoteStorage(f.options).mutate(seed)
    expect(f.adapter.peek().items).toEqual([])
    expect(f.adapter.peek().releases).toEqual({ 'sushi-v1': { status: 'dismissed' }, 'whitepaper-v1': { status: 'dismissed' } })
  })
  it.each(['{bad', '[]', 'null', JSON.stringify({ ...empty(), version: 2, resetToken: null }), JSON.stringify({ ...empty(), resetToken: null, extra: true }), JSON.stringify({ ...empty(), resetToken: null, partition: { ...scope, chainId: 'other' } })])('refuses corrupt v3 without v2/legacy fallback: %s', async raw => {
    const f = setup(); f.values.set(f.adapter.key, raw); f.values.set(v2Key, old({ status: 'pending' })); f.values.set(f.oldKey, JSON.stringify([pin]))
    expect(() => f.adapter.peek()).toThrow(); await expect(f.adapter.mutate(d => d)).rejects.toThrow()
    expect(f.readLegacy).not.toHaveBeenCalled(); expect(f.storage.getItem.mock.calls.every(([key]) => key === f.adapter.key)).toBe(true)
    expect(f.storage.setItem).not.toHaveBeenCalled(); expect(f.values.get(f.adapter.key)).toBe(raw)
  })
  it.each([
    '{bad', '[]', old({ status: 'dismissed', noteId: paper.noteId }),
    JSON.stringify({ version: 2, partition: { ...scope, chainId: 'other' }, items: [], whitepaper: { status: 'pending' } }),
    JSON.stringify({ version: 2, partition: { ...scope, wallet: sushi.owner }, items: [], whitepaper: { status: 'pending' } }),
    JSON.stringify({ version: 2, partition: scope, items: [], whitepaper: { status: 'pending' }, resetToken: false }),
  ])('refuses present invalid v2 instead of importing legacy: %s', async raw => {
    const f = setup(); f.values.set(v2Key, raw); f.values.set(f.oldKey, JSON.stringify([pin]))
    await expect(f.adapter.mutate(d => d)).rejects.toThrow(); expect(f.readLegacy).not.toHaveBeenCalled()
    expect(f.values.get(v2Key)).toBe(raw); expect(f.values.has(f.adapter.key)).toBe(false)
  })
  it('uses partitioned keys and never imports another chain or account v2 record', () => {
    const f = setup(); f.values.set('memba_os_desk:v2:other:guest', old({ status: 'dismissed' }, [pin]))
    f.values.set(`memba_os_desk:v2:test-chain:${sushi.owner}`, old({ status: 'pending' }, [pin]))
    expect(f.adapter.peek()).toEqual(empty())
    expect(createFeaturedNoteStorage({ ...f.options, scope: { ...scope, wallet: sushi.owner } }).key).toBe(`memba_os_desk:v3:test-chain:${sushi.owner}`)
  })
  it('preserves full legacy desks and fails on malformed items instead of truncating', async () => {
    const full = [0, 1, 2, 3].map(n => ({ ...pin, ref: `app${n}`, c: n % 2, r: Math.floor(n / 2) }))
    const f = setup(); f.values.set(f.oldKey, JSON.stringify(full))
    const result = await f.adapter.mutate(d => planFeaturedNoteSeeds(d, scope, rules, [sushi]).desk)
    expect(result.items).toEqual(full); expect(result.releases['sushi-v1'].status).toBe('pending')
    for (const items of [[...full, pin], [{ ...pin, c: 100 }], [{ ...pin, extra: true }]]) {
      const bad = setup(); const raw = JSON.stringify(items); bad.values.set(bad.oldKey, raw)
      await expect(bad.adapter.mutate(d => d)).rejects.toThrow(); expect(bad.values.get(bad.oldKey)).toBe(raw)
    }
  })
  it('read-latest under one lock retains independent concurrent tab updates', async () => {
    const f = setup(), second = createFeaturedNoteStorage(f.options), another = { ...pin, ref: 'settings', c: 1 }
    await Promise.all([f.adapter.mutate(append(pin)), second.mutate(append(another))])
    expect(f.adapter.peek().items).toEqual([pin, another]); expect(f.storage.setItem).toHaveBeenCalledTimes(2)
  })
  it('refuses unavailable locks and preserves all prior data on quota failure', async () => {
    const noLock = setup({ locks: null }); await expect(noLock.adapter.mutate(append(pin))).rejects.toThrow('Web Locks')
    expect(noLock.storage.setItem).not.toHaveBeenCalled()
    const f = setup(); const previous = old({ status: 'dismissed' }); f.values.set(v2Key, previous)
    f.storage.setItem.mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    await expect(f.adapter.mutate(d => d)).rejects.toThrow(); expect(f.values.get(v2Key)).toBe(previous); expect(f.values.has(f.adapter.key)).toBe(false)
    const raw = JSON.stringify({ ...empty(), resetToken: null }); f.values.set(f.adapter.key, raw)
    await expect(f.adapter.mutate(append(pin))).rejects.toThrow(); expect(f.values.get(f.adapter.key)).toBe(raw)
  })
  it('never falls back on storage exceptions and refuses invalid transform output', async () => {
    const blocked = setup(); blocked.storage.getItem.mockImplementation(() => { throw new Error('blocked') })
    expect(() => blocked.adapter.peek()).toThrow('blocked'); expect(blocked.readLegacy).not.toHaveBeenCalled()
    const f = setup(); await expect(f.adapter.mutate(d => ({ ...d, partition: { ...scope, chainId: 'other' } }))).rejects.toThrow()
    await expect(f.adapter.mutate((async () => empty()) as unknown as (d: FeaturedDesk) => FeaturedDesk)).rejects.toThrow()
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it('cancels an old lifetime or reset while awaiting a lock, before any read', async () => {
    let active = true, revision: string | null = null, resume: () => void = () => {}
    const wait = new Promise<void>(resolve => { resume = resolve })
    const lock: FeaturedLocks = { request: async (_name, _mode, run) => { await wait; return run() } }
    const f = setup({ locks: lock, isCurrent: () => active, getResetToken: () => revision })
    const pending = f.adapter.mutate(append(pin)); active = false; revision = 'reset1'; resume()
    await expect(pending).rejects.toThrow('session'); expect(f.storage.getItem).not.toHaveBeenCalled(); expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it('clears old-generation decisions only after validation and never resurrects legacy after reset', async () => {
    const f = setup(); const stale = JSON.stringify({ ...empty(), items: [pin], resetToken: null }); f.values.set(f.adapter.key, stale)
    const fresh = createFeaturedNoteStorage({ ...f.options, getResetToken: () => 'reset2' })
    expect(fresh.peek()).toEqual(empty()); await fresh.mutate(d => d)
    expect(JSON.parse(f.values.get(fresh.key)!)).toMatchObject({ resetToken: 'reset2' })
    f.values.delete(fresh.key); f.values.set(f.oldKey, JSON.stringify([pin])); f.readLegacy.mockClear()
    expect(fresh.peek()).toEqual(empty()); expect(f.readLegacy).not.toHaveBeenCalled()
    f.values.set(v2Key, old({ status: 'dismissed' }, [pin])); expect(fresh.peek()).toEqual(empty())
    f.values.set(v2Key, JSON.stringify({ version: 2, partition: scope, items: [{ ...pin, c: 10 }], whitepaper: { status: 'pending' } }))
    expect(() => fresh.peek()).toThrow()
  })
  it('retains a post-write checkpoint even when lifetime ends synchronously at commit', async () => {
    vi.useFakeTimers()
    try {
      let active = true, released = false
      const lock: FeaturedLocks = { request: async (_key, _mode, run) => { try { return await run() } finally { released = true } } }
      const f = setup({ locks: lock, isCurrent: () => active })
      f.storage.setItem.mockImplementation((key, raw) => { f.values.set(key, raw); active = false })
      const timer = vi.spyOn(globalThis, 'setTimeout')
      const pending = f.adapter.mutate(append(pin)), rejected = expect(pending).rejects.toThrow('session')
      expect(f.storage.getItem).not.toHaveBeenCalled(); expect(released).toBe(false)
      await vi.runAllTimersAsync(); await rejected
      expect(timer).toHaveBeenCalledTimes(2); expect(released).toBe(true)
      expect(JSON.parse(f.values.get(f.adapter.key)!).items).toEqual([pin]); timer.mockRestore()
    } finally { vi.useRealTimers() }
  })
  it('checks the lifetime again after the lock result and snapshots caller-owned initial state', async () => {
    let active = true
    const lock: FeaturedLocks = { request: async (_key, _mode, run) => { const result = await run(); active = false; return result } }
    const initial = [{ ...pin }], mutableScope = { ...scope }, f = setup({ initial, scope: mutableScope, locks: lock, isCurrent: () => active })
    initial[0].ref = 'changed'; mutableScope.chainId = 'other'
    expect(f.adapter.peek().items).toEqual([pin])
    await expect(f.adapter.mutate(d => d)).rejects.toThrow('session')
    expect(JSON.parse(f.values.get(f.adapter.key)!).items).toEqual([pin])
  })
})
