import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NETWORK, NETWORKS } from '../../lib/config'
import { bech32Encode } from '../../lib/dao/realmAddress'
import { NOTES_REALM } from '../../lib/notes/config'
import type { FeaturedNoteRelease } from '../../lib/notes/featuredNoteSeed'
import type { FeaturedLocks } from '../../lib/notes/featuredNoteStorage'
import { deskKey, type DeskItem } from './desk'
import * as deskModule from './desk'
import { useDesk } from './useDesk'
import type { FeaturedDeskOptions } from './useFeaturedDesk'
vi.mock('../../lib/notes/config', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/notes/config')>(), NOTES_ENABLED: true }))

const owner = bech32Encode('g', new Uint8Array(20).fill(1)), other = bech32Encode('g', new Uint8Array(20).fill(2))
const chainId = 'test-chain', key = (wallet: string | null = owner, version = 3) => `memba_os_desk:v${version}:${chainId}:${wallet ?? 'guest'}`
const pin: DeskItem = { ty: 'app', ref: 'wallet', c: 0, r: 0 }
const sushi: FeaturedNoteRelease = { releaseKey: 'sushi-v1', chainId, realm: NOTES_REALM, version: 1, noteId: 'ab'.repeat(16), mode: 4, deleted: false, owner }
const paper: FeaturedNoteRelease = { ...sushi, releaseKey: 'whitepaper-v1', noteId: 'cd'.repeat(16) }
const options: FeaturedDeskOptions = { chainId, gno: true, adopt: true, releases: [] }
const envelope = (items: DeskItem[], wallet: string | null = owner) => ({ version: 3, partition: { chainId, wallet }, items,
    releases: { 'sushi-v1': { status: 'pending' }, 'whitepaper-v1': { status: 'pending' } }, resetToken: null })
function serialLocks() {
    let tail: Promise<unknown> = Promise.resolve(), next: Promise<void> | null = null
    const locks: FeaturedLocks = { request: (_name, _options, work) => {
        const gate = next; next = null
        const result = tail.then(async () => { if (gate) await gate; return work() })
        tail = result.catch(() => {}); return result
    } }
    return { locks, hold: () => { let release!: () => void; next = new Promise<void>(resolve => { release = resolve }); return release }, idle: () => tail }
}
let scheduler: ReturnType<typeof serialLocks>
beforeEach(() => { localStorage.clear(); scheduler = serialLocks(); vi.stubGlobal('navigator', { locks: scheduler.locks }) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function settled() { await act(async () => { await scheduler.idle() }) }
const stored = (wallet: string | null = owner) => JSON.parse(localStorage.getItem(key(wallet))!)
function render(wallet?: string | null, opts = options, network = DEFAULT_NETWORK) {
    const account = arguments.length === 0 ? owner : wallet
    return renderHook(({ account, config, networkKey }) => useDesk(account, networkKey, config), { initialProps: { account, config: opts, networkKey: network } })
}

describe('one authoritative featured desktop', () => {
    it.each([owner, null])('imports exact historical default scope non-destructively: %s', async wallet => {
        const old = `memba_os_desk:${wallet ?? 'guest'}`, raw = JSON.stringify([pin])
        localStorage.setItem(old, raw)
        const hook = render(wallet); await settled()
        expect(hook.result.current.items).toEqual([pin]); expect(stored(wallet).items).toEqual([pin])
        expect(localStorage.getItem(old)).toBe(raw)
        expect(localStorage.getItem(deskKey(wallet))).toBeNull()
        expect(localStorage.getItem(`memba_os_desk:migrated:${wallet ?? 'guest'}`)).toBeNull()
    })
    it.each([[41, false], [48, false], [41, true], [48, true]] as const)('recovers %i legacy five-row pins, scoped=%s, without dropping identities or changing old bytes', async (count, scoped) => {
        const items: DeskItem[] = Array.from({ length: count }, (_, i) => ({ ty: 'dao', ref: `legacy_${i}`, c: 0, r: 0 }))
        const legacy = deskModule.cleanUp(items), raw = JSON.stringify(legacy)
        expect(legacy.some(item => item.c >= 8)).toBe(true)
        const oldKey = scoped ? deskKey(owner) : `memba_os_desk:${owner}`
        localStorage.setItem(oldKey, raw)
        const load = vi.spyOn(deskModule, 'loadDesk'), hook = render(); await settled()
        expect(hook.result.current.error).toBeNull(); expect(hook.result.current.items).toHaveLength(count)
        expect(stored().items.map((item: DeskItem) => [item.ty, item.ref])).toEqual(items.map(item => [item.ty, item.ref]))
        expect(stored().items.every((item: DeskItem) => item.c >= 0 && item.c < 8 && item.r >= 0 && item.r < 6)).toBe(true)
        expect(new Set(stored().items.map((item: DeskItem) => `${item.c}:${item.r}`)).size).toBe(count)
        expect(localStorage.getItem(oldKey)).toBe(raw); expect(load).not.toHaveBeenCalled()
    })
    it('keeps an overflowing legacy collection intact and refuses migration rather than dropping pins', async () => {
        const raw = JSON.stringify(deskModule.cleanUp(Array.from({ length: 49 }, (_, i): DeskItem => ({ ty: 'dao', ref: `legacy_${i}`, c: 0, r: 0 }))))
        localStorage.setItem(deskKey(owner), raw)
        const hook = render(); await settled()
        expect(hook.result.current.error).toBeTruthy(); expect(localStorage.getItem(key())).toBeNull()
        expect(localStorage.getItem(deskKey(owner))).toBe(raw)
    })
    it.each([false, true])('skips stale and malformed legacy entries like the legacy loader, scoped=%s, without changing old bytes', async scoped => {
        const dao: DeskItem = { ty: 'dao', ref: 'legacy_dao', c: 2, r: 0 }
        const raw = JSON.stringify([{ ...pin, label: 'extra' }, { ty: 'app', ref: 'removed_app', c: 2, r: 0 }, null, { ty: 'widget', ref: 'x', c: 3, r: 0 },
            { ty: 'dao', ref: '', c: 4, r: 0 }, { ty: 'dao', ref: 123, c: 5, r: 0 }, dao])
        const oldKey = scoped ? deskKey(owner) : `memba_os_desk:${owner}`
        localStorage.setItem(oldKey, raw)
        const hook = render(); await settled()
        expect(hook.result.current.error).toBeNull()
        expect(stored().items).toEqual([pin, dao]); expect(hook.result.current.items).toEqual([pin, dao])
        expect(localStorage.getItem(oldKey)).toBe(raw)
    })
    it('moves only legacy pins with unusable or taken cells into free cells', async () => {
        const raw = JSON.stringify([{ ty: 'app', ref: 'wallet', c: 'x', r: 0 }, { ty: 'dao', ref: 'legacy_dao', c: 0, r: 0 },
            { ty: 'app', ref: 'feed', c: 1.5, r: 0 }, { ty: 'dao', ref: 'kept_dao', c: 3, r: 4 }, { ty: 'dao', ref: 'twin_dao', c: 3, r: 4 }])
        localStorage.setItem(deskKey(owner), raw)
        const hook = render(); await settled()
        expect(hook.result.current.error).toBeNull()
        expect(stored().items).toEqual([{ ty: 'app', ref: 'wallet', c: 0, r: 1 }, { ty: 'dao', ref: 'legacy_dao', c: 0, r: 0 },
            { ty: 'app', ref: 'feed', c: 0, r: 2 }, { ty: 'dao', ref: 'kept_dao', c: 3, r: 4 }, { ty: 'dao', ref: 'twin_dao', c: 0, r: 3 }])
        expect(localStorage.getItem(deskKey(owner))).toBe(raw)
    })
    it('counts overflow after skipping stale legacy entries', async () => {
        const valid = Array.from({ length: 48 }, (_, i): DeskItem => ({ ty: 'dao', ref: `legacy_${i}`, c: Math.floor(i / 6), r: i % 6 }))
        const raw = JSON.stringify([...valid, { ty: 'app', ref: 'removed_app', c: 0, r: 0 }])
        localStorage.setItem(deskKey(owner), raw)
        const hook = render(); await settled()
        expect(hook.result.current.error).toBeNull(); expect(stored().items).toEqual(valid)
        expect(localStorage.getItem(deskKey(owner))).toBe(raw)
    })
    it.each([2, 3])('keeps strict geometry checks on v%i records', async version => {
        const items = [{ ...pin, c: 8 }]
        const raw = JSON.stringify(version === 3 ? envelope(items) : { version: 2, partition: { chainId, wallet: owner }, items, whitepaper: { status: 'pending' }, resetToken: null })
        localStorage.setItem(key(owner, version), raw)
        const hook = render(); await settled()
        expect(hook.result.current.error).toBeTruthy(); expect(hook.result.current.items).toEqual([])
        expect(localStorage.getItem(key(owner, version))).toBe(raw)
        if (version === 2) expect(localStorage.getItem(key())).toBeNull()
    })
    it.each([owner, null])('does not assign default legacy to another network: %s', async wallet => {
        localStorage.setItem(`memba_os_desk:${wallet ?? 'guest'}`, JSON.stringify([pin]))
        const network = Object.keys(NETWORKS).find(name => name !== DEFAULT_NETWORK)!
        render(wallet, options, network); await settled()
        expect(stored(wallet).items.some((item: DeskItem) => item.ref === 'wallet')).toBe(false)
    })
    it('does not migrate another wallet or a scope whose legacy marker exists', async () => {
        localStorage.setItem(`memba_os_desk:${other}`, JSON.stringify([pin]))
        localStorage.setItem(`memba_os_desk:${owner}`, JSON.stringify([pin]))
        localStorage.setItem(`memba_os_desk:migrated:${owner}`, 'any existing marker')
        const hook = render(); await settled(); expect(hook.result.current.items).toEqual([])
    })
    it('prefers present scoped bytes and never deletes old data', async () => {
        localStorage.setItem(`memba_os_desk:${owner}`, JSON.stringify([pin]))
        const scoped = JSON.stringify([{ ...pin, ref: 'feed' }]); localStorage.setItem(deskKey(owner), scoped)
        const hook = render(); await settled(); expect(hook.result.current.items[0].ref).toBe('feed')
        expect(localStorage.getItem(deskKey(owner))).toBe(scoped)
    })
    it.each(['scoped', 'v2', 'v3'])('fails closed on invalid present %s, without legacy fallback', async kind => {
        localStorage.setItem(`memba_os_desk:${owner}`, JSON.stringify([pin]))
        const badKey = kind === 'scoped' ? deskKey(owner) : key(owner, kind === 'v2' ? 2 : 3)
        localStorage.setItem(badKey, '{corrupt')
        const hook = render(); await settled()
        expect(hook.result.current.error).toBeTruthy(); expect(hook.result.current.items).toEqual([])
        expect(localStorage.getItem(badKey)).toBe('{corrupt')
        if (kind !== 'v3') expect(localStorage.getItem(key())).toBeNull()
    })
    it('imports v2 Whitepaper into its own marker, then independently seeds Sushi', async () => {
        localStorage.setItem(key(owner, 2), JSON.stringify({ version: 2, partition: { chainId, wallet: owner }, items: [], whitepaper: { status: 'dismissed' }, resetToken: null }))
        const hook = render(owner, { ...options, releases: [sushi, paper] }); await settled()
        expect(stored().releases).toEqual({ 'sushi-v1': { status: 'seeded', noteId: sushi.noteId }, 'whitepaper-v1': { status: 'dismissed' } })
        expect(hook.result.current.noteLabels[sushi.noteId]).toBe('Sushi recipe')
        expect(localStorage.getItem(key(owner, 2))).not.toBeNull()
    })
    it('serialises two mounts and keeps dismissal separate from a later Whitepaper release', async () => {
        const a = render(owner, { ...options, releases: [sushi] }), b = render(owner, { ...options, releases: [sushi] })
        await settled(); await waitFor(() => expect(a.result.current.items).toHaveLength(1))
        expect(stored().items).toHaveLength(1)
        act(() => a.result.current.unpin(0)); await settled()
        expect(b.result.current.items).toEqual([])
        b.rerender({ account: owner, config: { ...options, releases: [sushi, paper] }, networkKey: DEFAULT_NETWORK }); await settled()
        expect(stored().items.map((item: DeskItem) => item.ref)).toEqual([paper.noteId])
        expect(b.result.current.noteLabels[paper.noteId]).toBe('Whitepaper')
        expect(stored().releases['sushi-v1'].status).toBe('dismissed')
    })
    it('keeps a full desk pending and seeds only after a real cell is freed', async () => {
        const full: DeskItem[] = Array.from({ length: 48 }, (_, i) => ({ ty: 'dao', ref: `dao${i}`, c: Math.floor(i / 6), r: i % 6 }))
        localStorage.setItem(key(), JSON.stringify(envelope(full)))
        const hook = render(owner, { ...options, releases: [sushi] }); await settled()
        expect(stored().items).toHaveLength(48); expect(stored().releases['sushi-v1'].status).toBe('pending')
        act(() => hook.result.current.unpin(3)); await settled()
        expect(stored().items).toHaveLength(48); expect(stored().items.some((item: DeskItem) => item.ref === 'dao3')).toBe(false)
        expect(stored().items.some((item: DeskItem) => item.ref === sushi.noteId)).toBe(true)
    })
    it('reads latest items under lock instead of removing a stale numeric index', async () => {
        localStorage.setItem(key(), JSON.stringify(envelope([pin, { ...pin, ref: 'feed', r: 1 }])))
        const hook = render(); await settled()
        const release = scheduler.hold(); act(() => hook.result.current.unpin(0))
        const latest = stored(); latest.items.reverse(); localStorage.setItem(key(), JSON.stringify(latest))
        release(); await settled()
        expect(stored().items.map((item: DeskItem) => item.ref)).toEqual(['feed'])
    })
    it('revokes queued work and stale callbacks across A → B → A and lock → unlock', async () => {
        const hook = render(); await settled()
        const stale = hook.result.current.pin, release = scheduler.hold()
        act(() => stale({ ty: 'app', ref: 'feed' }))
        hook.rerender({ account: other, config: options, networkKey: DEFAULT_NETWORK })
        hook.rerender({ account: owner, config: { ...options, blocked: true }, networkKey: DEFAULT_NETWORK })
        hook.rerender({ account: owner, config: options, networkKey: DEFAULT_NETWORK })
        act(() => stale({ ty: 'app', ref: 'wallet' }))
        release(); await settled(); expect(stored().items).toEqual([])
    })
    it('reset revision cancels queued writes and prevents retained legacy resurrection', async () => {
        const old = `memba_os_desk:${owner}`; localStorage.setItem(old, JSON.stringify([pin]))
        const hook = render(); await settled(); const release = scheduler.hold()
        act(() => hook.result.current.pin({ ty: 'app', ref: 'feed' }))
        act(() => {
            localStorage.removeItem(key()); localStorage.setItem('memba_os_ui_reset_revision', 'new-generation')
            window.dispatchEvent(new StorageEvent('storage', { key: 'memba_os_ui_reset_revision', newValue: 'new-generation' }))
        })
        release(); await settled(); expect(stored().items).toEqual([]); expect(localStorage.getItem(old)).not.toBeNull()
    })
    it('continues v3 authority after rollback and refuses a late legacy write before a storage event', async () => {
        const hook = render(owner, { ...options, adopt: false }); const stale = hook.result.current.pin
        localStorage.setItem(key(), JSON.stringify(envelope([pin])))
        act(() => stale({ ty: 'app', ref: 'feed' })); await settled()
        expect(stored().items).toEqual([pin]); expect(localStorage.getItem(deskKey(owner))).toBeNull()
        localStorage.removeItem(key())
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: key(), newValue: null })))
        act(() => hook.result.current.pin({ ty: 'app', ref: 'feed' })); await settled()
        expect(stored().items.map((item: DeskItem) => item.ref)).toEqual(['feed']); expect(localStorage.getItem(deskKey(owner))).toBeNull()
    })
    it('switches a legacy mount on the exact storage event without loading legacy again', async () => {
        const load = vi.spyOn(deskModule, 'loadDesk'), hook = render(owner, { ...options, adopt: false })
        expect(load).toHaveBeenCalledTimes(1); load.mockClear()
        act(() => {
            localStorage.setItem(key(), JSON.stringify(envelope([pin])))
            window.dispatchEvent(new StorageEvent('storage', { key: key(), newValue: localStorage.getItem(key()) }))
        })
        await settled(); expect(hook.result.current.items).toEqual([pin]); expect(load).not.toHaveBeenCalled()
    })
    it.each(['present', 'corrupt', 'denied'])('never invokes loadDesk when newer authority is %s', async mode => {
        const load = vi.spyOn(deskModule, 'loadDesk')
        if (mode === 'denied') vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied') })
        else localStorage.setItem(key(), mode === 'present' ? JSON.stringify(envelope([pin])) : '{corrupt')
        render(owner, { ...options, adopt: false }); await settled()
        expect(load).not.toHaveBeenCalled()
    })
    it('tolerates both Shell and hook reset handlers without resurrecting a stale mutation', async () => {
        const hook = render(); await settled(); const stale = hook.result.current.pin
        act(() => {
            localStorage.removeItem(key()); localStorage.setItem('memba_os_ui_reset_revision', 'double-handler')
            window.dispatchEvent(new StorageEvent('storage', { key: 'memba_os_ui_reset_revision', newValue: 'double-handler' }))
            hook.result.current.resetFromStorage()
        })
        act(() => stale({ ty: 'app', ref: 'feed' })); await settled()
        expect(stored().items).toEqual([]); expect(stored().resetToken).toBe('double-handler')
    })
    it('does not adopt EVM or resuming identity and keeps the EVM legacy writer usable', async () => {
        const evm = '0x' + '12'.repeat(20), hook = render(undefined)
        await settled(); expect(localStorage.length).toBe(0); expect(hook.result.current.items).toEqual([])
        hook.rerender({ account: evm, config: { ...options, gno: false }, networkKey: 'base' })
        act(() => hook.result.current.pin({ ty: 'app', ref: 'feed' })); await settled()
        expect(localStorage.getItem(deskKey(evm, 'base'))).toContain('feed')
        expect(localStorage.getItem(key(evm))).toBeNull()
    })
    it('preserves old bytes and reports a missing lock rather than using an unlocked writer', async () => {
        vi.stubGlobal('navigator', {})
        const raw = JSON.stringify([pin]); localStorage.setItem(deskKey(owner), raw)
        const hook = render(); await waitFor(() => expect(hook.result.current.error).toBeTruthy())
        expect(localStorage.getItem(deskKey(owner))).toBe(raw); expect(localStorage.getItem(key())).toBeNull()
    })
    it('keeps bytes on a failed v3 save and never falls back', async () => {
        const raw = JSON.stringify(envelope([pin])); localStorage.setItem(key(), raw)
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
        const hook = render(); await settled(); expect(hook.result.current.error).toBeTruthy()
        expect(localStorage.getItem(key())).toBe(raw); expect(localStorage.getItem(deskKey(owner))).toBeNull()
    })
})
