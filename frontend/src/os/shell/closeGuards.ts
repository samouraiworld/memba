/** In-memory callbacks only. Never serialize a draft or its contents with windows. */
const guards = new Map<string, () => boolean>()

export function registerCloseGuard(key: string, guard: () => boolean): () => void {
    guards.set(key, guard)
    return () => { if (guards.get(key) === guard) guards.delete(key) }
}

export function mayCloseWindow(key: string): boolean {
    return guards.get(key)?.() ?? true
}
