import type { Token } from '../../gen/memba/v1/memba_pb'
import { walletBearer } from '../../lib/walletBearer'
import { FreePlayError, type FreePlayAuth, type FreePlayIdentity } from '../../lib/arcadeFreePlay'

/** Provided by the shared wallet/auth owner, never reconstructed from React
 * effects or localStorage here. Revision must change for EVERY transition,
 * including A→B→A before a render, and reads must fail closed while verifying.
 */
export interface BlockPartyAuthState {
    revision: string
    activeChainId: string
    connected: boolean
    walletVerified: boolean
    walletAddress: string
    walletChainId: string
    token: Token | null
}
export interface BlockPartyAuthSource {
    read(): BlockPartyAuthState
    subscribe(listener: () => void): () => void
}

/** Does not connect, authenticate, sign, persist or access wallet credentials.
 * Uses the existing REST token serializer; shared auth owns token acquisition.
 */
export function createBlockPartyFreePlayAuth(source: BlockPartyAuthSource, now = Date.now): FreePlayAuth & { dispose(): void } {
    let alive = true, epoch = 0
    const listeners = new Set<() => void>()
    const emit = () => { epoch++; for (const listener of listeners) listener() }
    const unsubscribe = source.subscribe(emit)
    function read(): { identity: FreePlayIdentity; token: Token } | null {
        if (!alive) return null
        const state = source.read()
        const token = state.token
        if (!state.revision || !state.connected || !state.walletVerified || !token
            || !state.walletAddress || state.walletAddress !== token.userAddress
            || !state.activeChainId || state.walletChainId !== state.activeChainId || token.chainId !== state.activeChainId
            || !token.nonce || !token.serverSignature || !Number.isFinite(Date.parse(token.expiration))
            || Date.parse(token.expiration) <= now()) return null
        return { identity: { player: state.walletAddress, chainId: state.activeChainId, revision: `${epoch}:${state.revision}` }, token }
    }
    return {
        identity() { return read()?.identity ?? null },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        async token(expected, signal) {
            if (signal.aborted) throw new FreePlayError('cancelled')
            const current = read()
            if (!current || current.identity.player !== expected.player || current.identity.chainId !== expected.chainId
                || current.identity.revision !== expected.revision) throw new FreePlayError('identity_changed')
            // The common client adds its own Bearer prefix and rechecks identity
            // after this promise, after I/O, and after commitment validation.
            return { token: walletBearer(current.token).slice('Bearer '.length), identity: current.identity }
        },
        dispose() { alive = false; unsubscribe(); emit(); listeners.clear() },
    }
}
