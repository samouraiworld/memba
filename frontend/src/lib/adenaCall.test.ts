import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ADENA_NO_POPUP_MS, ADENA_SLOW_MS, AdenaNoAnswerError, adenaPrompt, adenaRead, isAdenaWindowClosed, UNLOCK_TIMEOUT_MS } from "./adenaCall"
import { isWalletRequestPending } from "./walletActivity"

const never = () => new Promise<never>(() => {})

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("adenaRead", () => {
    it("returns Adena's answer when it comes in time", async () => {
        await expect(adenaRead(async () => "ok", 1_000)).resolves.toBe("ok")
    })

    it("rejects with a reload hint when Adena never answers", async () => {
        const read = adenaRead(never, 1_000)
        const settled = expect(read).rejects.toThrow("Adena didn't answer — reload this tab (needed after Adena updates).")
        await vi.advanceTimersByTimeAsync(1_000)
        await settled
        await expect(read).rejects.toBeInstanceOf(AdenaNoAnswerError)
    })

    it("passes Adena's own failure through unchanged", async () => {
        await expect(adenaRead(async () => { throw new Error("boom") }, 1_000)).rejects.toThrow("boom")
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe("adenaPrompt", () => {
    it("says when it is sent, then slow at 3 s, then no window at 8 s, and keeps waiting", async () => {
        let answer!: (v: string) => void
        const watch = { onSent: vi.fn(), onSlow: vi.fn(), onNoPopup: vi.fn(), onPopupFocus: vi.fn() }
        const prompt = adenaPrompt(() => new Promise<string>((r) => { answer = r }), watch)
        expect(watch.onSent).toHaveBeenCalledOnce()
        expect(isWalletRequestPending()).toBe(true)
        await vi.advanceTimersByTimeAsync(ADENA_SLOW_MS - 1)
        expect(watch.onSlow).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(watch.onSlow).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(ADENA_NO_POPUP_MS - ADENA_SLOW_MS)
        expect(watch.onNoPopup).toHaveBeenCalledOnce()
        answer("signed")
        await expect(prompt).resolves.toBe("signed")
        expect(isWalletRequestPending()).toBe(false)
        expect(watch.onPopupFocus).not.toHaveBeenCalled()
    })

    it("does not claim the window never opened once this page lost focus to it", async () => {
        const watch = { onNoPopup: vi.fn(), onPopupFocus: vi.fn() }
        const prompt = adenaPrompt(never, watch)
        prompt.catch(() => {})
        window.dispatchEvent(new Event("blur"))
        window.dispatchEvent(new Event("blur"))
        expect(watch.onPopupFocus).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(ADENA_NO_POPUP_MS)
        expect(watch.onNoPopup).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(UNLOCK_TIMEOUT_MS)
        await expect(prompt).rejects.toThrow(AdenaNoAnswerError)
    })

    it("gives a person the unlock budget, then rejects as no answer and releases the reload hold", async () => {
        const prompt = adenaPrompt(never)
        const settled = expect(prompt).rejects.toThrow(AdenaNoAnswerError)
        await vi.advanceTimersByTimeAsync(UNLOCK_TIMEOUT_MS - 1)
        expect(isWalletRequestPending()).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        await settled
        expect(isWalletRequestPending()).toBe(false)
    })

    it("stops its hints once Adena answered", async () => {
        const watch = { onSlow: vi.fn(), onNoPopup: vi.fn() }
        await expect(adenaPrompt(async () => "fast", watch)).resolves.toBe("fast")
        await vi.advanceTimersByTimeAsync(ADENA_NO_POPUP_MS)
        expect(watch.onSlow).not.toHaveBeenCalled()
        expect(watch.onNoPopup).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe("isAdenaWindowClosed", () => {
    it("reads UNEXPECTED_ERROR failures only", () => {
        expect(isAdenaWindowClosed({ status: "failure", type: "UNEXPECTED_ERROR" })).toBe(true)
        expect(isAdenaWindowClosed({ status: "failure", type: "CONNECTION_REJECTED" })).toBe(false)
        expect(isAdenaWindowClosed({ status: "success", type: "UNEXPECTED_ERROR" })).toBe(false)
        expect(isAdenaWindowClosed(null)).toBe(false)
    })
})
