import { describe, it, expect } from "vitest"
import { initState, applyEvent } from "../../../sim/engine"
import { createSnapshotStore } from "./useSimSnapshots"

// The bridge is the ONLY channel from sim → 3D renderer. It must publish the
// exact immutable snapshot references the sim produced (never a per-frame deep
// copy) and the renderer must only READ them — there is no write-back path. These
// are the bridge-purity invariants required by Part 6.

describe("snapshot bridge purity", () => {
    it("publishes the exact immutable references (no per-frame deep copy)", () => {
        const store = createSnapshotStore({ freeze: false })
        const prev = initState("bridge-test")
        const next = applyEvent(prev, { type: "move", lane: 1 }) // COW → a new state object
        store.publish(prev, next, 0.4)
        const s = store.read()
        expect(s.prev).toBe(prev)
        expect(s.next).toBe(next)
        expect(s.alpha).toBe(0.4)
    })

    it("reading the snapshot never mutates the published SimState", () => {
        const store = createSnapshotStore({ freeze: false })
        const next = initState("bridge-test")
        const before = JSON.stringify(next)
        store.publish(null, next, 0)
        const s = store.read()
        // simulate a renderer frame reading the snapshot
        void s.next!.enemies.length
        void s.next!.barricadeHp
        void s.alpha
        expect(JSON.stringify(next)).toBe(before)
    })

    it("dev tripwire: a published snapshot is frozen so an accidental write-back throws", () => {
        const store = createSnapshotStore({ freeze: true })
        const next = initState("bridge-test")
        store.publish(null, next, 0)
        expect(() => {
            ;(store.read().next as unknown as { barricadeHp: number }).barricadeHp = 0
        }).toThrow()
    })

    it("dev tripwire also catches NESTED write-backs (array element write + frozen collections)", () => {
        const store = createSnapshotStore({ freeze: true })
        const next = initState("bridge-test") // turrets = [0, 0, 0]
        store.publish(null, next, 0)
        const s = store.read().next!
        // a per-lane turret write is a realistic renderer mistake — must throw, not
        // silently corrupt the sim (the shallow-freeze gap this closes)
        expect(() => {
            s.turrets[0] = 5
        }).toThrow()
        expect(Object.isFrozen(s.enemies)).toBe(true)
        expect(Object.isFrozen(s.projectiles)).toBe(true)
        expect(Object.isFrozen(s.hazards)).toBe(true)
    })
})
