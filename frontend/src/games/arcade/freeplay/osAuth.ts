import type { Token } from '../../../gen/memba/v1/memba_pb'
import { onAdenaAccountChanged } from '../../../hooks/useAdena'
import { onSessionInvalidated } from '../../../lib/authSession'
import { assertWalletBroadcastSafe, getWalletRpcContext, onWalletRpcContextChanged, walletActionTicket } from '../../../lib/grc20'
import { walletBearer } from '../../../lib/walletBearer'
import { FreePlayError, type FreePlayAuth, type FreePlayIdentity } from '../../../lib/arcadeFreePlay'

export interface FreePlayOsSession {
    status: 'resuming' | 'guest' | 'member'
    token: Token | null
    address: string
    walletAddress: string
    walletChainId: string
    chainId: string
}
/** The approved shared getter must return an immutable copy, and its observer
 * must fire synchronously even for the intermediate unverified network state.
 * A React snapshot cannot implement this port.
 */
export interface FreePlayLiveWallet {
    read(): Readonly<{ revision: number; address: string | null; chainId: string | null; trusted: boolean }>
    subscribe(listener: () => void): () => void
}

/** New local bridge only; D supplies the committed OS session and live wallet
 * observer (the approved shared context by default). Neither shared hooks nor token storage are changed or read here.
 * Construct in an owner lifecycle, call refreshIdentity after OS commits, then
 * dispose on unmount. The default reads live context; an injected port must preserve that contract.
 */
export function createOsFreePlayAuth(options: { readSession(): FreePlayOsSession; liveWallet?: FreePlayLiveWallet; now?: () => number }): FreePlayAuth & { refreshIdentity(): void; dispose(): void } {
    const now = options.now ?? Date.now
    const liveWallet = options.liveWallet ?? { read: getWalletRpcContext, subscribe: onWalletRpcContextChanged }
    let actionTicket = walletActionTicket()
    const listeners = new Set<() => void>()
    let revision = 0, alive = true, fingerprint = '', rejectedToken = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let notifying = false
    const notify = () => {
        revision++
        // Subscribers may synchronously read identity while the OS is locked.
        // Coalesce nested notifications; every transition still advances revision.
        if (notifying) return
        notifying = true
        try {
            for (const listener of [...listeners]) {
                if (!listeners.has(listener)) continue
                try { listener() } catch { /* other sessions must also invalidate */ }
            }
        } finally { notifying = false }
    }
    function inspect() {
        const session = options.readSession()
        const wallet = liveWallet.read()
        const token = session.token
        const bearer = token ? walletBearer(token).slice('Bearer '.length) : ''
        const expiresAt = token ? Date.parse(token.expiration) : NaN
        const expired = !Number.isFinite(expiresAt) || expiresAt <= now()
        let permitted = false
        try { actionTicket(); assertWalletBroadcastSafe(); permitted = true } catch { /* locked, disconnected or unverified */ }
        const valid = permitted && session.status === 'member' && !!token && !!token.nonce && !!token.serverSignature
            && !!bearer && bearer !== rejectedToken && !expired
            && Number.isSafeInteger(wallet.revision) && wallet.revision >= 0 && wallet.trusted
            && wallet.address === session.walletAddress && wallet.address === session.address && wallet.address === token.userAddress
            && !!session.chainId && wallet.chainId === session.chainId && session.walletChainId === session.chainId && token.chainId === session.chainId
        // Credential bytes remain private in memory and never enter a revision,
        // snapshot, error, event payload or the discovery index.
        const next = JSON.stringify([session.status, session.address, session.walletAddress, session.walletChainId, session.chainId, bearer, wallet.revision, wallet.address, wallet.chainId, wallet.trusted, expired, valid])
        return { valid, bearer, expiresAt, next, player: token?.userAddress ?? '', chainId: session.chainId }
    }
    function refreshIdentity() {
        if (!alive) return
        // Signing epoch changes (including OS lock/unlock) are independent of
        // RPC setter events. Observe the existing ticket at every boundary.
        try { actionTicket() } catch { actionTicket = walletActionTicket(); notify() }
        let next = 'unavailable', expiry = NaN
        try { const state = inspect(); next = state.next; expiry = state.expiresAt } catch { /* fail closed */ }
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
        const remaining = expiry - now()
        if (Number.isFinite(remaining) && remaining > 0) timer = setTimeout(refreshIdentity, Math.min(remaining, 2147483647))
        if (next !== fingerprint) { fingerprint = next; notify() }
    }
    const invalidateSessionToken = () => {
        try { const token = options.readSession().token; if (token) rejectedToken = walletBearer(token).slice('Bearer '.length) } catch { /* still invalidate */ }
        // Every event changes the revision, including A→B→A in one React batch.
        notify(); refreshIdentity()
    }
    const removeAccount = onAdenaAccountChanged(invalidateSessionToken)
    const removeSession = onSessionInvalidated(invalidateSessionToken)
    const removeWallet = liveWallet.subscribe(() => { notify(); refreshIdentity() })
    refreshIdentity()
    function identity(): FreePlayIdentity | null {
        if (!alive) return null
        refreshIdentity()
        try { const state = inspect(); return state.valid ? { player: state.player, chainId: state.chainId, revision: String(revision) } : null } catch { return null }
    }
    return {
        identity,
        refreshIdentity,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        async token(expected, signal) {
            if (signal.aborted) throw new FreePlayError('cancelled')
            const current = identity()
            if (!current || current.player !== expected.player || current.chainId !== expected.chainId || current.revision !== expected.revision) throw new FreePlayError('identity_changed')
            const state = inspect()
            if (!state.valid) throw new FreePlayError('identity_changed')
            return { identity: current, token: state.bearer }
        },
        dispose() {
            alive = false
            if (timer !== undefined) clearTimeout(timer)
            removeAccount(); removeSession(); removeWallet(); notify(); listeners.clear()
        },
    }
}
