/**
 * useNow.test.ts — the ticking-clock hook that keeps relative times alive.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useNow } from "./useNow"

afterEach(() => vi.useRealTimers())

describe("useNow", () => {
    it("advances the returned timestamp on each interval tick", () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => useNow(15_000))
        const first = result.current
        act(() => { vi.advanceTimersByTime(15_000) })
        expect(result.current).toBeGreaterThanOrEqual(first + 15_000)
    })

    it("does not change before the interval elapses", () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => useNow(15_000))
        const first = result.current
        act(() => { vi.advanceTimersByTime(5_000) })
        expect(result.current).toBe(first)
    })

    it("clears its interval on unmount (no leaked timer)", () => {
        vi.useFakeTimers()
        const clearSpy = vi.spyOn(globalThis, "clearInterval")
        const { unmount } = renderHook(() => useNow(15_000))
        unmount()
        expect(clearSpy).toHaveBeenCalled()
    })
})
