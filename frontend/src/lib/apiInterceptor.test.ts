import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Code, ConnectError } from '@connectrpc/connect'
import { authSelfHeal } from './api'
import { EVM_TOKEN_KEY, TOKEN_KEY, hasStoredToken, onSessionInvalidated } from './authSession'

// The interceptor's SCOPE is the load-bearing part, and it cuts both ways:
//  - too narrow and F-29 is not fixed (a dead token strands the user again)
//  - too broad and a failed sign-in attempt logs out a working session, since
//    GetToken denials ride PermissionDenied rather than Unauthenticated
// Both directions are pinned below.
const req = {} as Parameters<ReturnType<typeof authSelfHeal>>[0]

function run(err: unknown) {
    return authSelfHeal(() => Promise.reject(err))(req)
}

describe('authSelfHeal interceptor — F-29', () => {
    beforeEach(() => {
        localStorage.clear()
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ userAddress: 'g1abc' }))
    })

    it('clears the session on Unauthenticated (a rejected token)', async () => {
        await expect(run(new ConnectError('', Code.Unauthenticated))).rejects.toBeTruthy()
        expect(hasStoredToken()).toBe(false)
    })

    it('does NOT clear on PermissionDenied — a failed LOGIN must not end a good session', async () => {
        // GetToken denials (bad signature, session account, wrong chain) use
        // PermissionDenied. Treating them as a logout would mean one fumbled
        // sign-in attempt destroys an already-working session.
        await expect(run(new ConnectError('', Code.PermissionDenied))).rejects.toBeTruthy()
        expect(hasStoredToken()).toBe(true)
    })

    it('does not clear on ordinary transport or server failures', async () => {
        for (const code of [Code.Unavailable, Code.Internal, Code.DeadlineExceeded, Code.ResourceExhausted]) {
            await expect(run(new ConnectError('', code))).rejects.toBeTruthy()
            expect(hasStoredToken()).toBe(true)
        }
        // A plain network error must not look like a rejected token either —
        // an offline blip should not sign the user out.
        await expect(run(new Error('network down'))).rejects.toBeTruthy()
        expect(hasStoredToken()).toBe(true)
    })

    it('re-throws so callers still see the failure', async () => {
        const err = new ConnectError('nope', Code.Unauthenticated)
        await expect(run(err)).rejects.toBe(err)
    })

    it('passes successful responses straight through', async () => {
        const ok = { ok: true }
        const next = vi.fn().mockResolvedValue(ok)
        await expect(authSelfHeal(next)(req)).resolves.toBe(ok)
        expect(hasStoredToken()).toBe(true)
    })
})

// One session per network family: a rejected token ends only its own family's session.
describe('authSelfHeal interceptor — scoped to the family of the token the request carried', () => {
    const GNO = { userAddress: 'g1abc', chainId: 'gnoland-1' }
    const EVM = { userAddress: '0xabc', chainId: 'eip155:84532' }
    const carrying = (authToken: object) => ({ message: { authToken } }) as unknown as Parameters<ReturnType<typeof authSelfHeal>>[0]
    const reject = (r: Parameters<ReturnType<typeof authSelfHeal>>[0]) => authSelfHeal(() => Promise.reject(new ConnectError('', Code.Unauthenticated)))(r)

    beforeEach(() => {
        localStorage.clear()
        localStorage.setItem(TOKEN_KEY, JSON.stringify(GNO))
        localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify(EVM))
    })

    it('a rejected EVM token ends the EVM session only, never the gno.land one', async () => {
        const gno = vi.fn(), evm = vi.fn()
        const stop = [onSessionInvalidated(gno), onSessionInvalidated(evm, 'evm')]
        await expect(reject(carrying(EVM))).rejects.toBeTruthy()
        expect(localStorage.getItem(EVM_TOKEN_KEY)).toBeNull()
        expect(hasStoredToken()).toBe(true)
        expect(evm).toHaveBeenCalledTimes(1)
        expect(gno).not.toHaveBeenCalled()
        stop.forEach((s) => s())
    })

    it('a rejected gno.land token ends the gno.land session only, never the EVM one', async () => {
        const gno = vi.fn(), evm = vi.fn()
        const stop = [onSessionInvalidated(gno), onSessionInvalidated(evm, 'evm')]
        await expect(reject(carrying(GNO))).rejects.toBeTruthy()
        expect(hasStoredToken()).toBe(false)
        expect(localStorage.getItem(EVM_TOKEN_KEY)).not.toBeNull()
        expect(gno).toHaveBeenCalledTimes(1)
        expect(evm).not.toHaveBeenCalled()
        stop.forEach((s) => s())
    })
})
