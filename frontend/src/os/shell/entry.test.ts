import { afterEach, describe, expect, it } from "vitest"
import { markSeen, OS_SEEN_KEY, readSeen, resolveEntry } from "./entry"

afterEach(() => localStorage.clear())

describe("resolveEntry (D7)", () => {
    it("shows the lock screen on a first plain visit", () => {
        expect(resolveEntry({ seen: false, resuming: false, deepLink: false })).toBe("lock")
    })

    it("never shows it again once seen", () => {
        expect(resolveEntry({ seen: true, resuming: false, deepLink: false })).toBe("guest")
    })

    it("resumes a wallet session without the lock screen, even on a first visit to /os", () => {
        expect(resolveEntry({ seen: false, resuming: true, deepLink: false })).toBe("resume")
        expect(resolveEntry({ seen: false, resuming: true, deepLink: true })).toBe("resume")
    })

    it("opens a shared link as a guest, without the lock screen", () => {
        expect(resolveEntry({ seen: false, resuming: false, deepLink: true })).toBe("link")
    })
})

describe("seen flag", () => {
    it("round-trips through this browser's storage", () => {
        expect(readSeen()).toBe(false)
        markSeen()
        expect(localStorage.getItem(OS_SEEN_KEY)).toBe("1")
        expect(readSeen()).toBe(true)
    })
})
