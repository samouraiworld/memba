/** Page-lifetime guard: a release recovery must not interrupt wallet decisions. */
let pending = 0
const listeners = new Set<() => void>()
export const isWalletRequestPending = () => pending > 0
export function subscribeWalletActivity(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
function notify() { for (const listener of listeners) listener() }
export async function withWalletActivity<T>(operation: () => Promise<T>): Promise<T> {
    pending++
    notify()
    try { return await operation() }
    finally { pending--; notify() }
}
