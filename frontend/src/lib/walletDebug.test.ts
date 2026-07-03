/** W5.1 — walletDebug: disabled by default, ring-buffered when enabled. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { logWalletEvent, installWalletLogDump, __resetWalletDebug } from "./walletDebug"

beforeEach(() => { localStorage.clear(); __resetWalletDebug() })
afterEach(() => { vi.restoreAllMocks() })

describe("walletDebug", () => {
    it("is a no-op when the flag is unset", () => {
        const spy = vi.spyOn(console, "debug")
        logWalletEvent("connected")
        installWalletLogDump()
        expect(spy).not.toHaveBeenCalled()
        expect((window as Record<string, unknown>).__membaWalletLog).toBeUndefined()
    })

    it("logs + exposes the dump when enabled", () => {
        localStorage.setItem("memba_wallet_debug", "1")
        __resetWalletDebug()
        const spy = vi.spyOn(console, "debug").mockImplementation(() => {})
        logWalletEvent("connected", "silent")
        installWalletLogDump()
        expect(spy).toHaveBeenCalledOnce()
        const dump = (window as Record<string, unknown>).__membaWalletLog as () => unknown[]
        expect(dump()).toHaveLength(1)
    })

    it("caps the ring buffer at 100 events", () => {
        localStorage.setItem("memba_wallet_debug", "1")
        __resetWalletDebug()
        vi.spyOn(console, "debug").mockImplementation(() => {})
        for (let i = 0; i < 150; i++) logWalletEvent(`e${i}`)
        installWalletLogDump()
        const dump = (window as Record<string, unknown>).__membaWalletLog as () => { event: string }[]
        expect(dump()).toHaveLength(100)
        expect(dump()[0].event).toBe("e50")
    })
})
