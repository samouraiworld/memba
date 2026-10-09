import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFreePlayClient, hashFreePlayFields, type FreePlayIdentity, type FreePlayInput, type FreePlayRun } from '../../../lib/arcadeFreePlay'
import vectors from './vectors.json'
const v = vectors.runs[0]
const input = { ...v.input, claimedScore: v.score } as FreePlayInput
const binding = { player: v.player, target: v.target }
function run(): FreePlayRun {
    return { target: v.target, clientRunId: input.clientRunId, payloadHash: v.payloadHash, replayCodec: input.replayCodec, replay: input.replay, status: 'verified', entry: { game: input.game, player: v.player, rules: input.rules, simVersion: input.simVersion, runID: v.runID, seed: input.seed, score: v.score, stateHash: v.stateHash, replayHash: v.replayHash } }
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
function setup() {
    let identity: FreePlayIdentity = { player: v.player, chainId: v.target.chainId, revision: '1' }
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(run())))
    const auth = { identity: () => identity, subscribe: () => () => {}, token: vi.fn(async (i: FreePlayIdentity) => ({ token: 'private-token', identity: i })) }
    const client = createFreePlayClient({ origin: 'https://backend.example', target: v.target, auth, fetch: fetcher })
    return { client, fetcher, auth, change: (next: Partial<FreePlayIdentity>) => { identity = { ...identity, ...next } } }
}
describe('Free play injected API', () => {
    it('matches the independent LP and completed replay vectors', async () => {
        for (const lp of vectors.lp) expect(await hashFreePlayFields(...lp.fields)).toBe(lp.sha256)
        const { client, fetcher } = setup()
        expect(await client.verify(binding, input, new AbortController().signal)).toEqual(run())
        expect(fetcher).toHaveBeenCalledTimes(1)
        const [, init] = fetcher.mock.calls[0]
        expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', method: 'POST', headers: { Authorization: 'Bearer private-token' } })
    })
    it('refuses a response for a different run, payload, player or network', async () => {
        for (const mutate of [
            (r: FreePlayRun) => { r.target = { ...r.target, chainId: 'onyx-1' } },
            (r: FreePlayRun) => { r.entry.score++ },
            (r: FreePlayRun) => { r.payloadHash = '0'.repeat(64) },
            (r: FreePlayRun) => { r.entry.replayHash = '0'.repeat(64) },
        ]) {
            const { client, fetcher } = setup(); const wrong = run(); mutate(wrong)
            fetcher.mockResolvedValue(new Response(JSON.stringify(wrong)))
            await expect(client.verify(binding, input, new AbortController().signal)).rejects.toThrow('run_conflict')
        }
    })
    it('does not send after a wallet or network changes while acquiring the token', async () => {
        const s = setup(); const token = deferred<{ token: string; identity: FreePlayIdentity }>()
        s.auth.token.mockImplementation(() => token.promise)
        const pending = s.client.verify(binding, input, new AbortController().signal)
        s.change({ chainId: 'onyx-1', revision: '2' })
        token.resolve({ token: 'private-token', identity: { player: v.player, chainId: v.target.chainId, revision: '1' } })
        await expect(pending).rejects.toThrow('identity_changed')
        expect(s.fetcher).not.toHaveBeenCalled()
    })
    it('rejects a late response after a session changes away and back', async () => {
        const s = setup(); const entered = deferred<void>(); const reply = deferred<Response>()
        s.fetcher.mockImplementation(async () => { entered.resolve(); return reply.promise })
        const pending = s.client.verify(binding, input, new AbortController().signal)
        await entered.promise
        s.change({ revision: '3' })
        reply.resolve(new Response(JSON.stringify(run())))
        await expect(pending).rejects.toThrow('identity_changed')
    })
    it('requires an exact committed receipt before accepting confirmed', async () => {
        const { client, fetcher } = setup(); const wrong = run(); wrong.status = 'confirmed'
        fetcher.mockResolvedValue(new Response(JSON.stringify(wrong)))
        await expect(client.read(binding, input, new AbortController().signal)).rejects.toThrow('invalid_response')
    })
})
