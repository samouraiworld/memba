import { afterEach, describe, expect, it } from "vitest"
import { markLocked, OS_LOCKED_KEY, readLocked, resolveEntry } from "./entry"

afterEach(() => localStorage.clear())

describe("resolveEntry", () => {
    it("offers Connect or Guest on every plain visit by default", () => {
        expect(resolveEntry({ skipIntro: false, resuming: false, deepLink: false })).toBe("lock")
        expect(resolveEntry({ skipIntro: false, resuming: true, deepLink: false })).toBe("lock")
    })

    it("skips the choice only when requested in Settings", () => {
        expect(resolveEntry({ skipIntro: true, resuming: false, deepLink: false })).toBe("guest")
        expect(resolveEntry({ skipIntro: true, resuming: true, deepLink: false })).toBe("resume")
    })

    it("opens a direct link immediately", () => {
        expect(resolveEntry({ skipIntro: false, resuming: false, deepLink: true })).toBe("link")
        expect(resolveEntry({ skipIntro: false, resuming: true, deepLink: true })).toBe("resume")
    })

    it("keeps an explicit lock across reload, including shared links and a reconnecting wallet", () => {
        expect(resolveEntry({ skipIntro: true, resuming: false, deepLink: true, locked: true })).toBe("lock")
        expect(resolveEntry({ skipIntro: true, resuming: true, deepLink: false, locked: true })).toBe("lock")
        markLocked(true)
        expect(localStorage.getItem(OS_LOCKED_KEY)).toBe("1")
        expect(readLocked()).toBe(true)
        markLocked(false)
        expect(readLocked()).toBe(false)
    })
})
