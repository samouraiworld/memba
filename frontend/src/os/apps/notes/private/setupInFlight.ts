// Identity setups handed to the signing driver and not settled yet, by operation ID, for this page. The driver's
// `pending` list only holds a request while it is verified; this also covers the review and the open wallet, so a
// setup hidden while Adena still holds it is never offered "Set up again".
const held = new Map<string, number>(), listeners = new Set<() => void>()
let version = 0
const changed = () => { version++; for (const listener of listeners) listener() }

/** Marks `operationId` in flight until the returned release runs (once: later calls do nothing). */
export function holdSetup(operationId: string): () => void {
    held.set(operationId, (held.get(operationId) ?? 0) + 1); changed()
    let released = false
    return () => {
        if (released) return
        released = true
        const count = (held.get(operationId) ?? 1) - 1
        if (count > 0) held.set(operationId, count); else held.delete(operationId)
        changed()
    }
}
export const setupInFlight = (operationId: string) => held.has(operationId)
export function subscribeSetupsInFlight(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export const setupsInFlightVersion = () => version
