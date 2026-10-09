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
            (r: FreePlayRun) => { r.entry.player = 'g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq' },
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

describe('Free play public boards', () => {
    const query = { game: input.game, rules: input.rules, simVersion: input.simVersion, offset: 0, limit: 20 }
    const receipt = () => ({ target: v.target, entry: run().entry, height: 42, attester: v.player, schemaVersion: 2 as const })
    const board = () => ({ target: v.target, game: input.game, rules: input.rules, simVersion: input.simVersion, entries: [receipt()] })
    it('uses the shared transport without credentials and preserves exact pagination/context', async () => {
        const s = setup(); s.change({ chainId: 'onyx-1' })
        s.fetcher.mockResolvedValue(new Response(JSON.stringify(board())))
        expect(await s.client.board(query, new AbortController().signal)).toEqual(board())
        expect(s.auth.token).not.toHaveBeenCalled()
        const [url, init] = s.fetcher.mock.calls[0]
        expect(String(url)).toContain('/boards/block-party?rules=bp-free-standard-undo-v1&simVersion=1&offset=0&limit=20')
        expect(init?.headers).toBeUndefined(); expect(init?.credentials).toBe('omit')
    })
    it('rejects other contexts, malformed receipts and repeated players', async () => {
        for (const mutate of [
            (b: ReturnType<typeof board>) => { b.target = { ...b.target, chainId: 'onyx-1' } },
            (b: ReturnType<typeof board>) => { b.game = 'barricade' },
            (b: ReturnType<typeof board>) => { b.entries[0].entry.rules = 'other' },
            (b: ReturnType<typeof board>) => { b.entries[0].entry.simVersion++ },
            (b: ReturnType<typeof board>) => { b.entries[0].height = 0 },
            (b: ReturnType<typeof board>) => { b.entries.push(receipt()) },
        ]) {
            const s = setup(); const value = board(); mutate(value)
            s.fetcher.mockResolvedValue(new Response(JSON.stringify(value)))
            await expect(s.client.board(query, new AbortController().signal)).rejects.toThrow('invalid_board')
        }
    })
    it('distinguishes unavailable from empty and bounds requests before network I/O', async () => {
        const s = setup(); s.fetcher.mockResolvedValueOnce(new Response('{}', { status: 503 }))
        await expect(s.client.board(query, new AbortController().signal)).rejects.toThrow('leaderboard_unavailable')
        s.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...board(), entries: [] })))
        expect((await s.client.board(query, new AbortController().signal)).entries).toEqual([])
        s.fetcher.mockClear()
        await expect(s.client.board({ ...query, limit: 101 }, new AbortController().signal)).rejects.toThrow('invalid_board')
        expect(s.fetcher).not.toHaveBeenCalled()
    })
})


describe('Free play bearer transport origin', () => {
    it('refuses remote HTTP and misleading loopback hosts before any auth or fetch', () => {
        const identity = vi.fn(() => null), token = vi.fn(), subscribe = vi.fn(), fetcher = vi.fn<typeof fetch>()
        for (const origin of [
            'http://backend.example', 'http://192.168.1.10:8080', 'http://0.0.0.0',
            'http://localhost.example', 'http://sub.localhost', 'http://localhost.',
            'http://127.0.0.1.example', 'http://localhost@backend.example',
            'http://[::2]', 'http://[::ffff:127.0.0.1]', 'http://127.1',
            'http://2130706433', 'http://0x7f000001', 'not-a-url',
        ]) expect(() => createFreePlayClient({ origin, target: v.target, auth: { identity, token, subscribe }, fetch: fetcher })).toThrow('invalid_endpoint')
        expect(identity).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled()
        expect(subscribe).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
    })
    it('accepts HTTPS and literal localhost, IPv4 and IPv6 loopback for explicit local calls', async () => {
        for (const origin of ['https://backend.example', 'http://localhost:8080', 'http://127.0.0.1:8080/', 'http://[::1]:8080']) {
            const s = setup()
            const client = createFreePlayClient({ origin, target: v.target, auth: s.auth, fetch: s.fetcher })
            await expect(client.verify(binding, input, new AbortController().signal)).resolves.toEqual(run())
            expect(s.auth.token).toHaveBeenCalledTimes(1); expect(s.fetcher).toHaveBeenCalledTimes(1)
            const [url, init] = s.fetcher.mock.calls[0]
            expect(new URL(String(url)).origin).toBe(new URL(origin).origin)
            expect(init).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer private-token' } })
        }
    })
})
