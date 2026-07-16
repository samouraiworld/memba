/**
 * useSimSnapshots.ts — the sim → 3D-renderer bridge (Phase 0, PR-0b).
 *
 * The single, one-way channel: `onFrame` publishes the two latest sim snapshots
 * (`prev`, `next`) plus the sub-tick `alpha`, and the 3D scene READS them inside
 * the single render loop. It publishes the exact immutable references the sim
 * produced (the sim is copy-on-write, so those objects are never re-mutated) —
 * NOT a per-frame deep copy — and exposes no write-back path. A dev-only freeze of
 * each published state AND its mutable collections turns an accidental renderer
 * write-back into a thrown error instead of silent sim corruption. See Part 6
 * (bridge-purity invariants).
 */
import { useState } from "react"
import type { SimState } from "../../../sim/types"

export interface SimSnapshot {
    prev: SimState | null
    next: SimState | null
    alpha: number
}

export interface SnapshotStore {
    /** Called from onFrame with the two latest sim states + the sub-tick alpha. */
    publish(prev: SimState | null, next: SimState, alpha: number): void
    /** Read the current snapshot (the stable holder object) inside the render loop. */
    read(): SimSnapshot
}

// Dev tripwire: freeze each published state AND its mutable collections so an
// accidental write-back from the renderer — `state.barricadeHp = …`,
// `enemies[i].pos = …`, `enemies.push(…)`, `turrets[i] = …` — throws instead of
// silently corrupting the sim. Not a freeze of every scalar; it covers the sim's
// actual write-back surface (the arrays + their elements). The real guarantee is
// the copy-on-write sim + a read-only renderer — this just makes a mistake loud in
// dev. Prod skips it entirely (allocation-free at 60Hz).
function freezeSnapshotState(s: SimState): void {
    for (const e of s.enemies) Object.freeze(e)
    for (const p of s.projectiles) Object.freeze(p)
    for (const h of s.hazards) Object.freeze(h)
    Object.freeze(s.enemies)
    Object.freeze(s.projectiles)
    Object.freeze(s.hazards)
    Object.freeze(s.turrets)
    Object.freeze(s)
}

/**
 * Create a snapshot store. `freeze` (default: dev builds) freezes published
 * states so an accidental write-back from the renderer throws; prod leaves it off
 * to stay allocation- and overhead-free at 60Hz.
 */
export function createSnapshotStore(opts: { freeze?: boolean } = {}): SnapshotStore {
    const freeze = opts.freeze ?? import.meta.env.DEV
    // One stable holder of IMMUTABLE references — never re-created per frame, so
    // the renderer can hold onto it and always see the latest snapshot.
    const snap: SimSnapshot = { prev: null, next: null, alpha: 0 }
    return {
        publish(prev, next, alpha) {
            if (freeze) {
                if (prev) freezeSnapshotState(prev)
                freezeSnapshotState(next)
            }
            snap.prev = prev
            snap.next = next
            snap.alpha = alpha
        },
        read() {
            return snap
        },
    }
}

/**
 * React hook: a stable snapshot store for the barricade route lifetime. The store
 * lives in a ref so publishing at 60Hz never triggers React re-renders.
 */
export function useSimSnapshots(): SnapshotStore {
    // useState lazy-initializer (not useRef): creates the store exactly once for
    // the route lifetime without accessing a ref during render (react-hooks/refs)
    // and without ever triggering a re-render (the setter is intentionally unused).
    const [store] = useState(() => createSnapshotStore())
    return store
}
