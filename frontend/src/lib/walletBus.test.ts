/**
 * walletBus tests (B-5 Phase 2a).
 *
 * The bus is the shared wallet source for the CAL bridge: useAdena instances
 * PUBLISH identity transitions (connect success / disconnect / account change
 * on wallet network switch); the root ChainContextProvider SUBSCRIBES. It is
 * write-only from useAdena and read-only for the CAL — existing consumers
 * never read it, so flag-off behavior cannot change.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { getWalletSnapshot, subscribe, publishWalletState, resetWalletBusForTests } from "./walletBus"

beforeEach(() => {
    resetWalletBusForTests()
})

describe("walletBus", () => {
    it("starts disconnected", () => {
        expect(getWalletSnapshot()).toEqual({ connected: false, address: "" })
    })

    it("publish updates the snapshot and notifies subscribers", () => {
        const seen: unknown[] = []
        const unsub = subscribe(() => seen.push(getWalletSnapshot()))
        publishWalletState({ connected: true, address: "g1pub" })
        expect(getWalletSnapshot()).toEqual({ connected: true, address: "g1pub" })
        expect(seen).toEqual([{ connected: true, address: "g1pub" }])
        unsub()
    })

    it("a redundant publish is a NO-OP: same snapshot identity, no notification", () => {
        publishWalletState({ connected: true, address: "g1same" })
        const before = getWalletSnapshot()
        const cb = vi.fn()
        const unsub = subscribe(cb)
        publishWalletState({ connected: true, address: "g1same" })
        // Identity-stable snapshot is what keeps useSyncExternalStore from
        // re-rendering on redundant publishes (Object.is check).
        expect(getWalletSnapshot()).toBe(before)
        expect(cb).not.toHaveBeenCalled()
        unsub()
    })

    it("unsubscribe stops notifications", () => {
        const cb = vi.fn()
        const unsub = subscribe(cb)
        unsub()
        publishWalletState({ connected: true, address: "g1x" })
        expect(cb).not.toHaveBeenCalled()
    })

    it("disconnect transition round-trips", () => {
        publishWalletState({ connected: true, address: "g1y" })
        publishWalletState({ connected: false, address: "" })
        expect(getWalletSnapshot()).toEqual({ connected: false, address: "" })
    })

    it("a subscriber that throws does not break the others", () => {
        const good = vi.fn()
        const unsub1 = subscribe(() => { throw new Error("boom") })
        const unsub2 = subscribe(good)
        publishWalletState({ connected: true, address: "g1z" })
        expect(good).toHaveBeenCalledTimes(1)
        unsub1(); unsub2()
    })
})
