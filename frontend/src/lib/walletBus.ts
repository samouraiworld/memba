/**
 * walletBus — shared wallet identity source for the Chain Abstraction Layer
 * (B-5 Phase 2a).
 *
 * WHY: useAdena keeps per-hook-instance React state and instances never
 * cross-sync. The root ChainContextProvider previously owned its own instance,
 * which missed interactive connects made through other instances (until a
 * visibilitychange retry) and never saw disconnects — a stale wallet bridge.
 *
 * The bus inverts the flow: every useAdena instance PUBLISHES its identity
 * TRANSITIONS here (connect success, disconnect, account change on a wallet
 * network switch — mount defaults never publish, so a freshly-mounted
 * disconnected instance cannot clobber a connected bus), and the CAL bridge
 * SUBSCRIBES via useSyncExternalStore. Write-only from useAdena, read-only
 * for the CAL: no existing consumer reads it, so flag-off behavior is
 * untouched, and dropping the root's own useAdena instance also removes its
 * duplicated silent GetAccount + analytics event.
 *
 * NOT a general wallet store: pages keep their own useAdena state exactly as
 * before. Seeding useAdena FROM the bus would change live app behavior and is
 * deliberately out of scope (recorded in B5_CAL_MOUNT_PLAN Phase 2).
 */

export interface WalletBusState {
    connected: boolean
    /** Connected wallet address (g1…), "" when disconnected. */
    address: string
}

const INITIAL: WalletBusState = { connected: false, address: "" }

let _state: WalletBusState = INITIAL
const _subscribers = new Set<() => void>()

/** Current snapshot. Identity-stable between publishes (and across redundant
 *  publishes), as useSyncExternalStore requires. */
export function getWalletSnapshot(): WalletBusState {
    return _state
}

/** Subscribe to state changes. Returns the unsubscribe function. */
export function subscribe(callback: () => void): () => void {
    _subscribers.add(callback)
    return () => { _subscribers.delete(callback) }
}

/**
 * Publish a wallet identity transition. Shallow-equal publishes are NO-OPs
 * (no new snapshot identity, no notifications) — concurrent silent reconnects
 * from several useAdena instances land the same state idempotently.
 */
export function publishWalletState(next: WalletBusState): void {
    if (next.connected === _state.connected && next.address === _state.address) return
    _state = { connected: next.connected, address: next.address }
    for (const cb of _subscribers) {
        try {
            cb()
        } catch (err) {
            // One broken subscriber must not starve the others.
            console.error("[walletBus] subscriber threw:", err)
        }
    }
}

/** Test-only: restore the pristine module state between tests. */
export function resetWalletBusForTests(): void {
    _state = INITIAL
    _subscribers.clear()
}
