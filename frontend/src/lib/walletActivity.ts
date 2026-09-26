/** Page-lifetime guard: a release recovery must not interrupt wallet decisions. */
let pending = 0
const listeners = new Set<() => void>()
export const isWalletRequestPending = () => pending > 0
export function subscribeWalletActivity(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
function notify() { for (const listener of listeners) listener() }
/** Hold reloads from the start of an interactive review until it closes. */
export function beginWalletActivity(): () => void {
    pending++
    notify()
    let ended = false
    return () => {
        if (ended) return
        ended = true
        pending--
        notify()
    }
}
export async function withWalletActivity<T>(operation: () => Promise<T>): Promise<T> {
    const end = beginWalletActivity()
    try { return await operation() }
    finally { end() }
}
