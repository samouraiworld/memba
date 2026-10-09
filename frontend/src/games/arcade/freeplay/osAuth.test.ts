import { webcrypto } from 'node:crypto'
import { create } from '@bufbuild/protobuf'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenSchema } from '../../../gen/memba/v1/memba_pb'
import { __resetWalletStoreForTests, useAdena } from '../../../hooks/useAdena'
import { createFreePlayClient, type FreePlayInput } from '../../../lib/arcadeFreePlay'
import { invalidateSession, TOKEN_KEY } from '../../../lib/authSession'
import { GNO_CHAIN_ID } from '../../../lib/config'
import { bumpWalletActionEpoch, getWalletRpcContext, onWalletRpcContextChanged, setWalletActionGuard, setWalletRpcContext, walletActionTicket } from '../../../lib/grc20'
import { createOsFreePlayAuth, type FreePlayOsSession } from './osAuth'
import vectors from './vectors.json'

const player = vectors.runs[0].player
const rpc = 'https://rpc.gno.land:443'
const bridges: ReturnType<typeof createOsFreePlayAuth>[] = []
const removals: (() => void)[] = []
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function setup() {
    let session: FreePlayOsSession = {
        status: 'member', address: player, walletAddress: player, walletChainId: GNO_CHAIN_ID, chainId: GNO_CHAIN_ID,
        token: create(TokenSchema, { userAddress: player, chainId: GNO_CHAIN_ID, nonce: 'test-nonce', serverSignature: 'test-signature', expiration: new Date(Date.now() + 60_000).toISOString() }),
    }
    const auth = createOsFreePlayAuth({ readSession: () => session })
    bridges.push(auth)
    return { auth, session: () => session, update: (next: Partial<FreePlayOsSession>) => { session = { ...session, ...next }; auth.refreshIdentity() } }
}
function installProvider() {
    const events = new Map<string, () => void>()
    const account = { status: 'success', data: { address: player, chainId: GNO_CHAIN_ID, coins: '0ugnot', publicKey: { '@type': '/tm.PubKeySecp256k1', value: 'Awxxx==' }, accountNumber: '1', sequence: '0' } }
    const network = { status: 'success', data: { rpcUrl: rpc } }
    const provider = {
        GetAccount: vi.fn(async () => account), GetNetwork: vi.fn(async () => network),
        AddEstablish: vi.fn(async () => ({ status: 'success' })),
        On: vi.fn((event: string, cb: () => void) => { events.set(event, cb); return true }),
    }
    ;(window as unknown as Record<string, unknown>).adena = provider
    return { provider, events, account, network }
}
beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto)
    localStorage.clear(); sessionStorage.clear(); __resetWalletStoreForTests()
    setWalletActionGuard(null)
    setWalletRpcContext(rpc, true, GNO_CHAIN_ID, player)
})
afterEach(() => {
    for (const bridge of bridges.splice(0)) bridge.dispose()
    for (const remove of removals.splice(0)) remove()
    cleanup(); setWalletActionGuard(null); setWalletRpcContext(null, false)
    delete (window as unknown as Record<string, unknown>).adena
    vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('read-only wallet RPC observation', () => {
    it('returns frozen copies and advances every setter without changing signing epoch semantics', () => {
        const initial = getWalletRpcContext(), ticket = walletActionTicket()
        const seen: ReturnType<typeof getWalletRpcContext>[] = []
        removals.push(onWalletRpcContextChanged(() => seen.push(getWalletRpcContext())))
        setWalletRpcContext(rpc, true, GNO_CHAIN_ID, player)
        setWalletRpcContext(null, false, 'other-chain', player)
        setWalletRpcContext(rpc, true, GNO_CHAIN_ID, player)
        expect(seen.map(s => s.revision)).toEqual([1, 2, 3].map(n => initial.revision + n))
        expect(Object.isFrozen(initial)).toBe(true)
        expect(initial).not.toBe(getWalletRpcContext())
        expect(initial.trusted).toBe(true)
        expect(seen[1]).toMatchObject({ trusted: false, chainId: 'other-chain', address: player })
        expect(ticket).not.toThrow()
    })
    it('isolates throwing and reentrant subscribers and supports unsubscribe', () => {
        const broken = vi.fn(() => { throw new Error('observer') })
        const nested = vi.fn(() => setWalletRpcContext(rpc, true, GNO_CHAIN_ID, player))
        const last = vi.fn()
        removals.push(onWalletRpcContextChanged(broken), onWalletRpcContextChanged(nested))
        const remove = onWalletRpcContextChanged(last); removals.push(remove)
        const revision = getWalletRpcContext().revision
        setWalletRpcContext(null, false)
        expect(getWalletRpcContext().revision).toBe(revision + 2)
        expect(nested).toHaveBeenCalledTimes(1); expect(last).toHaveBeenCalledTimes(1)
        remove(); setWalletRpcContext(null, false)
        expect(last).toHaveBeenCalledTimes(1)
    })
})

describe('Free play OS authentication bridge using real event sources', () => {
    it('invalidates a pending client request during the real Adena network re-read, even when it returns to A', async () => {
        const p = installProvider()
        const hook = renderHook(() => useAdena())
        await act(async () => { await hook.result.current.wake(); await hook.result.current.connect() })
        const s = setup(), before = s.auth.identity()!
        expect(before).not.toBeNull()
        const target = { ...vectors.runs[0].target, chainId: GNO_CHAIN_ID }
        const reply = deferred<Response>(), entered = deferred<void>()
        const fetcher = vi.fn<typeof fetch>(async () => { entered.resolve(); return reply.promise })
        const client = createFreePlayClient({ origin: 'https://backend.example', target, auth: s.auth, fetch: fetcher })
        const pending = client.verify({ player, target }, { ...vectors.runs[0].input, claimedScore: vectors.runs[0].score } as FreePlayInput, new AbortController().signal)
        const rejected = expect(pending).rejects.toThrow('identity_changed')
        await entered.promise
        const net = deferred<typeof p.network>()
        p.provider.GetNetwork.mockImplementationOnce(() => net.promise)
        act(() => p.events.get('changedNetwork')!())
        expect(s.auth.identity()).toBeNull() // React still carries the original member session.
        await expect(s.auth.token(before, new AbortController().signal)).rejects.toThrow('identity_changed')
        await act(async () => { net.resolve(p.network); await net.promise })
        expect(s.auth.identity()).toMatchObject({ player, chainId: GNO_CHAIN_ID })
        expect(s.auth.identity()!.revision).not.toBe(before.revision)
        reply.resolve(new Response('{}')); await rejected
        expect(fetcher).toHaveBeenCalledTimes(1)
        act(() => hook.result.current.disconnect())
        expect(s.auth.identity()).toBeNull()
    })
    it('rejects the old token after actual account and session invalidation events', async () => {
        const p = installProvider(), s = setup(), first = s.auth.identity()!
        p.events.get('changedAccount')!()
        expect(s.auth.identity()).toBeNull()
        s.update({ token: create(TokenSchema, { ...s.session().token!, nonce: 'second-token' }) })
        expect(s.auth.identity()).not.toBeNull()
        localStorage.setItem(TOKEN_KEY, 'test-only-token')
        invalidateSession('unauthorized')
        expect(s.auth.identity()).toBeNull()
        await expect(s.auth.token(first, new AbortController().signal)).rejects.toThrow('identity_changed')
        s.update({ token: create(TokenSchema, { ...s.session().token!, nonce: 'third-token' }) })
        expect(s.auth.identity()).not.toBeNull()
    })
    it('uses the existing action ticket for lock/unlock and A→B→A OS transitions without an RPC event', async () => {
        let unlocked = true
        setWalletActionGuard(() => unlocked)
        const s = setup(), before = s.auth.identity()!
        const listener = vi.fn(() => s.auth.identity())
        s.auth.subscribe(listener)
        unlocked = false; bumpWalletActionEpoch(); s.auth.refreshIdentity()
        expect(s.auth.identity()).toBeNull()
        expect(listener.mock.calls.length).toBeLessThan(20) // synchronous reads cannot recurse forever
        unlocked = true; bumpWalletActionEpoch(); s.auth.refreshIdentity()
        await expect(s.auth.token(before, new AbortController().signal)).rejects.toThrow('identity_changed')
        const fresh = s.auth.identity()!
        expect(fresh).not.toBeNull()
        bumpWalletActionEpoch(); bumpWalletActionEpoch()
        await expect(s.auth.token(fresh, new AbortController().signal)).rejects.toThrow('identity_changed')
        s.update({ status: 'guest' }); expect(s.auth.identity()).toBeNull()
    })
    it('expires credentials without an OS render and rejects mismatch, cancellation and disposal', async () => {
        vi.useFakeTimers()
        const s = setup(), identity = s.auth.identity()!, listener = vi.fn()
        s.auth.subscribe(listener)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(s.auth.identity()).toBeNull(); expect(listener).toHaveBeenCalled()
        s.update({ token: create(TokenSchema, { ...s.session().token!, expiration: new Date(Date.now() + 60_000).toISOString(), chainId: 'other-chain' }) })
        expect(s.auth.identity()).toBeNull()
        const abort = new AbortController(); abort.abort()
        await expect(s.auth.token(identity, abort.signal)).rejects.toThrow('cancelled')
        s.auth.dispose(); expect(s.auth.identity()).toBeNull()
    })
})
