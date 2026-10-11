/** In-memory callbacks only. Never serialize a draft or its contents with windows. */
const guards = new Map<string, Set<() => boolean>>()

/** Several parts of one window may hold unsaved text; each registers its own guard. */
export function registerCloseGuard(key: string, guard: () => boolean): () => void {
    const set = guards.get(key) ?? new Set()
    guards.set(key, set); set.add(guard)
    return () => { set.delete(guard); if (!set.size && guards.get(key) === set) guards.delete(key) }
}

/** Asks each guard in turn; the first refusal keeps the window open. */
export function mayCloseWindow(key: string): boolean {
    for (const guard of [...guards.get(key) ?? []]) if (!guard()) return false
    return true
}
