import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Code, ConnectError } from '@connectrpc/connect'
import { authSelfHeal } from './api'
import { TOKEN_KEY, hasStoredToken } from './authSession'

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
