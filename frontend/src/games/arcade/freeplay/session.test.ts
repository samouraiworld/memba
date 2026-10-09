import { describe, expect, it, vi } from 'vitest'
import type { FreePlayClient, FreePlayInput, FreePlayQuote, FreePlayRun } from '../../../lib/arcadeFreePlay'
import { createFreePlaySnapshot, loadFreePlaySnapshot, sanitizeSnapshot } from './snapshot'
import { createFreePlaySession } from './session'
import vectors from './vectors.json'
const v = vectors.runs[0]
const input = { ...v.input, claimedScore: v.score } as FreePlayInput
const binding = { player: v.player, target: v.target }
const run: FreePlayRun = { target: v.target, clientRunId: input.clientRunId, payloadHash: v.payloadHash, replayCodec: input.replayCodec, replay: input.replay, status: 'verified', entry: { game: input.game, player: v.player, rules: input.rules, simVersion: input.simVersion, runID: v.runID, seed: input.seed, score: v.score, stateHash: v.stateHash, replayHash: v.replayHash } }
const quote: FreePlayQuote = { quoteId: 'a'.repeat(64), nonce: 'b'.repeat(64), runID: v.runID, payloadHash: v.payloadHash, payer: 'studio', expiresAt: 1000, maxFeeUgnot: 100, maxDepositUgnot: 200 }
function setup() {
    const saved = new Map<string, string>()
    const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, value: string) => { saved.set(k, value) } }
    const listeners = new Set<() => void>()
    const client = {
        board: vi.fn(),
        subscribeIdentity: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
        bind: () => binding,
        verify: vi.fn(async () => structuredClone(run)), read: vi.fn(async () => structuredClone(run)),
        quote: vi.fn(async () => structuredClone(quote)), publish: vi.fn<FreePlayClient['publish']>(async () => ({ ...structuredClone(run), status: 'queued' as const })),
    } satisfies FreePlayClient
    const session = createFreePlaySession({ snapshot: createFreePlaySnapshot(input), storage, client, now: () => 20 })
    return { client, storage, saved, session, changed: () => { for (const listener of listeners) listener() } }
}
describe('Free play completed-run snapshots', () => {
    it('projects only known fields and never stores credentials', () => {
        const clean = sanitizeSnapshot({ schemaVersion: 1, token: 'secret', input: { ...input, token: 'secret' }, binding: { ...binding, revision: 'private' } })
        expect(JSON.stringify(clean)).not.toContain('secret')
        expect(JSON.stringify(clean)).not.toContain('revision')
        expect(clean.input.replay).toBe(input.replay)
    })
    it('persists the same explicit publication request across ambiguity and reload', async () => {
        const s = setup()
        await s.session.verify(); await s.session.quote()
        expect(s.client.publish).not.toHaveBeenCalled()
        s.client.publish.mockRejectedValueOnce(new Error('response lost'))
        await s.session.publish()
        expect(s.session.getSnapshot().phase).toBe('error')
        const snapshot = loadFreePlaySnapshot(s.storage, input.clientRunId)!
        expect(snapshot.publication).toEqual({ payloadHash: quote.payloadHash, quoteId: quote.quoteId, nonce: quote.nonce })
        s.session.dispose()
        const resumed = createFreePlaySession({ snapshot, storage: s.storage, client: s.client, now: () => 2000 })
        expect(resumed.getSnapshot().phase).toBe('saved')
        await resumed.retryPublication()
        expect(resumed.getSnapshot().phase).toBe('pending')
        expect(s.client.publish).toHaveBeenCalledTimes(2)
        expect(s.client.publish.mock.calls[0].slice(0, 3)).toEqual(s.client.publish.mock.calls[1].slice(0, 3))
        expect(s.client.quote).toHaveBeenCalledTimes(1)
    })
    it('does not consider a stored receipt confirmed until authenticated readback', async () => {
        const s = setup()
        const confirmed: FreePlayRun = { ...run, status: 'confirmed', receipt: { target: v.target, entry: run.entry, height: 42, attester: v.player, schemaVersion: 2 } }
        s.client.read.mockResolvedValue(confirmed)
        const snapshot = sanitizeSnapshot({ schemaVersion: 1, input, binding, result: confirmed })
        const resumed = createFreePlaySession({ snapshot, storage: { getItem: () => null, setItem: () => {} }, client: s.client })
        expect(resumed.getSnapshot().phase).toBe('saved')
        await resumed.refresh()
        expect(resumed.getSnapshot().phase).toBe('confirmed')
    })
    it('invalidates a late callback after a wallet/network change even if transport ignores abort', async () => {
        const s = setup(); let resolve!: (r: FreePlayRun) => void
        s.client.verify.mockImplementation(() => new Promise(r => { resolve = r }))
        const pending = s.session.verify()
        s.changed()
        resolve(run)
        await pending
        expect(s.session.getSnapshot().phase).toBe('saved')
        expect(loadFreePlaySnapshot(s.storage, input.clientRunId)?.result).toBeUndefined()
    })
    it('keeps later runs separate and blocks an altered replay under the same UUID', async () => {
        const s = setup(); let resolve!: (r: FreePlayRun) => void
        s.client.verify.mockImplementation(() => new Promise(r => { resolve = r }))
        const pending = s.session.verify()
        s.session.dispose()
        const second = createFreePlaySession({ snapshot: createFreePlaySnapshot({ ...input, clientRunId: '11111111-1111-4111-8111-111111111111' }), storage: s.storage, client: s.client })
        resolve(run); await pending
        expect(second.getSnapshot().snapshot.result).toBeUndefined()
        expect([...s.saved.keys()].filter(key => key.startsWith("memba:arcade:freeplay:v1:"))).toHaveLength(2)
        expect(() => createFreePlaySession({ snapshot: createFreePlaySnapshot({ ...input, replay: input.replay + 'Z' }), storage: s.storage, client: s.client })).toThrow('run_conflict')
    })
})

it('never sends publication when its consent cannot be persisted', async () => {
    const s = setup(); await s.session.verify(); await s.session.quote()
    const save = s.storage.setItem
    s.storage.setItem = (key, raw) => {
        if (JSON.parse(raw).publication) throw new DOMException('storage full', 'QuotaExceededError')
        save(key, raw)
    }
    await s.session.publish()
    expect(s.client.publish).not.toHaveBeenCalled()
    expect(s.session.getSnapshot().phase).toBe('error')
    expect(s.session.getSnapshot().snapshot.input).toEqual(input)
    expect(loadFreePlaySnapshot(s.storage, input.clientRunId)?.input).toEqual(input)
    expect(loadFreePlaySnapshot(s.storage, input.clientRunId)?.publication).toBeUndefined()
})

it('requires fresh explicit consent for an expired queued quote and never renews an unknown send', async () => {
    const s = setup(); await s.session.verify(); await s.session.quote(); await s.session.publish()
    const expired: FreePlayRun = { ...run, status: 'queued', lastError: 'quote_expired', canReauthorize: true }
    s.client.read.mockResolvedValue(expired)
    const nextQuote = { ...quote, quoteId: 'c'.repeat(64), nonce: 'd'.repeat(64), expiresAt: 3000 }
    s.client.quote.mockResolvedValue(nextQuote)
    await s.session.refresh()
    expect(s.session.getSnapshot()).toMatchObject({ phase: 'pending', canReauthorize: true, error: 'quote_expired' })
    await s.session.quote()
    expect(s.session.getSnapshot().phase).toBe('quoted')
    expect(s.client.publish).toHaveBeenCalledTimes(1)
    expect(loadFreePlaySnapshot(s.storage, input.clientRunId)?.publication?.nonce).toBe(quote.nonce)
    await s.session.publish()
    expect(s.client.publish).toHaveBeenCalledTimes(2)
    expect(loadFreePlaySnapshot(s.storage, input.clientRunId)?.publication?.nonce).toBe(nextQuote.nonce)
    s.client.read.mockResolvedValue({ ...run, status: 'submitted', lastError: 'confirmation_pending', canReauthorize: false })
    await s.session.quote()
    expect(s.session.getSnapshot().phase).toBe('pending')
    expect(s.client.quote).toHaveBeenCalledTimes(2)
})

it('does not send if the shared index fails after consent was saved; reload retries the same consent', async () => {
    const s = setup(); await s.session.verify(); await s.session.quote()
    const save = s.storage.setItem
    s.storage.setItem = (key, raw) => { if (key === 'memba:arcade:freeplay:index:v1') throw new DOMException('full', 'QuotaExceededError'); save(key, raw) }
    await s.session.publish()
    expect(s.client.publish).not.toHaveBeenCalled()
    expect(s.session.getSnapshot().phase).toBe('error')
    const saved = loadFreePlaySnapshot(s.storage, input.clientRunId)!
    expect(saved.publication).toEqual({ payloadHash: quote.payloadHash, quoteId: quote.quoteId, nonce: quote.nonce })
    s.session.dispose()
    s.storage.setItem = save
    const resumed = createFreePlaySession({ snapshot: saved, storage: s.storage, client: s.client, now: () => 2000 })
    expect(resumed.getSnapshot().phase).toBe('saved')
    await resumed.retryPublication()
    expect(s.client.publish).toHaveBeenCalledTimes(1)
    expect(s.client.publish.mock.calls[0][2]).toEqual(saved.publication)
    expect(s.client.quote).toHaveBeenCalledTimes(1)
    resumed.dispose()
})
