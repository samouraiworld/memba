import { afterEach, describe, expect, it, vi } from "vitest"
import { withFeeCheck } from "./recheck"

const later = <T,>(value: T | Error, ms: number) => new Promise<T>((resolve, reject) => setTimeout(() => (value instanceof Error ? reject(value) : resolve(value)), ms))

afterEach(() => { vi.useRealTimers() })

describe("withFeeCheck", () => {
    it("waits for both reads at once, not one after the other", async () => {
        vi.useFakeTimers()
        let done = false
        const both = withFeeCheck(later("state", 100), later("fee", 100)).then((v) => { done = true; return v })
        await vi.advanceTimersByTimeAsync(100)
        expect(done).toBe(true)
        await expect(both).resolves.toBe("state")
    })

    it("reports the state's refusal first, whichever answer arrives first", async () => {
        await expect(withFeeCheck(later(new Error("state changed"), 20), later(new Error("fee rose"), 1))).rejects.toThrow("state changed")
        await expect(withFeeCheck(later("ok", 1), later(new Error("fee rose"), 1), () => { throw new Error("state refused") })).rejects.toThrow("state refused")
        await expect(withFeeCheck(later("ok", 1), later(new Error("fee rose"), 1))).rejects.toThrow("fee rose")
    })

    it("checks what the state read before passing it on", async () => {
        const check = vi.fn()
        await expect(withFeeCheck(Promise.resolve({ n: 1 }), Promise.resolve(), check)).resolves.toEqual({ n: 1 })
        expect(check).toHaveBeenCalledWith({ n: 1 })
    })
})
