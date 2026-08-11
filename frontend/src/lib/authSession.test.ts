import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    TOKEN_KEY,
    clearStoredToken,
    hasStoredToken,
    invalidateSession,
    onSessionInvalidated,
} from './authSession'

// F-29's durable half. The backend fix stops us MINTING a token for a chain we
// do not serve; this stops an ALREADY-ISSUED bad token from stranding the user
// — which is what covers everyone already carrying one, and every other way a
// token can go dead (rotated server key, signature that no longer recomputes).
//
// The old behaviour: useAuth cleared on natural expiry only, so a rejected
// token sat in localStorage until it expired while the app looked signed in
// and every call 401'd. A reload rehydrated the same dead token, because
// loadToken also only checks expiry. The only escape was clearing site data.
describe('authSession — F-29 self-heal', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('clears the stored token and notifies listeners', () => {
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ userAddress: 'g1abc' }))
        const seen: string[] = []
        const off = onSessionInvalidated((reason) => seen.push(reason))

        invalidateSession('rejected by server')

        expect(hasStoredToken()).toBe(false)
        expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
        expect(seen).toEqual(['rejected by server'])
        off()
    })

    it('is idempotent — concurrent 401s must not cascade logouts', () => {
        // Several in-flight requests routinely fail together. Each one calls
        // invalidateSession, and only the first has a session to tear down.
        localStorage.setItem(TOKEN_KEY, '{}')
        const listener = vi.fn()
        const off = onSessionInvalidated(listener)

        invalidateSession('first')
        invalidateSession('second')
        invalidateSession('third')

        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith('first')
        off()
    })

    it('does not notify when there was no session to invalidate', () => {
        const listener = vi.fn()
        const off = onSessionInvalidated(listener)
        invalidateSession('nothing to do')
        expect(listener).not.toHaveBeenCalled()
        off()
    })

    it('unsubscribes cleanly', () => {
        localStorage.setItem(TOKEN_KEY, '{}')
        const listener = vi.fn()
        onSessionInvalidated(listener)()
        invalidateSession('after unsubscribe')
        expect(listener).not.toHaveBeenCalled()
    })

    it('one throwing listener does not stop the others from healing', () => {
        localStorage.setItem(TOKEN_KEY, '{}')
        const good = vi.fn()
        const offBad = onSessionInvalidated(() => { throw new Error('boom') })
        const offGood = onSessionInvalidated(good)

        expect(() => invalidateSession('reason')).not.toThrow()
        expect(good).toHaveBeenCalledWith('reason')
        offBad(); offGood()
    })

    it('survives localStorage being unavailable', () => {
        const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('private browsing')
        })
        expect(() => clearStoredToken()).not.toThrow()
        spy.mockRestore()
    })
})
