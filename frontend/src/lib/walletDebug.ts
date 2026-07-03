/**
 * walletDebug — W5.1: opt-in wallet session-event log for diagnosing
 * disconnect reports in the field.
 *
 * Enable in the browser console:   localStorage.memba_wallet_debug = "1"
 * Dump the ring buffer:            window.__membaWalletLog()
 *
 * Zero overhead when disabled (one localStorage read, cached). Events are
 * kept in a 100-entry ring buffer and mirrored to console.debug so a user
 * report can include exact timestamps for connect/reconnect/lock cycles.
 * No addresses or signatures are logged — event names + coarse detail only.
 */

const FLAG_KEY = "memba_wallet_debug"
const MAX_EVENTS = 100

interface WalletEvent {
    t: string // ISO timestamp
    event: string
    detail?: string
}

let enabled: boolean | null = null
const ring: WalletEvent[] = []

function isEnabled(): boolean {
    if (enabled === null) {
        try { enabled = localStorage.getItem(FLAG_KEY) === "1" } catch { enabled = false }
    }
    return enabled
}

/** Test hook: re-read the flag and clear the buffer. */
export function __resetWalletDebug(): void {
    enabled = null
    ring.length = 0
}

/** Record a wallet lifecycle event (no-op unless the debug flag is set). */
export function logWalletEvent(event: string, detail?: string): void {
    if (!isEnabled()) return
    const e: WalletEvent = { t: new Date().toISOString(), event, ...(detail ? { detail } : {}) }
    ring.push(e)
    if (ring.length > MAX_EVENTS) ring.shift()
    console.debug(`[wallet] ${e.t} ${event}${detail ? ` — ${detail}` : ""}`)
}

/** Expose the dump helper for bug reports. */
export function installWalletLogDump(): void {
    if (!isEnabled()) return
    ;(window as unknown as Record<string, unknown>).__membaWalletLog = () => [...ring]
}
