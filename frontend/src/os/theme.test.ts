import { afterEach, describe, expect, it, vi } from "vitest"
import { OS_THEME_KEY, readThemePref, resolveTheme, writeThemePref } from "./theme"
import { DEFAULT_WALLPAPER, getWallpaper, WALLPAPERS } from "./wallpapers"

afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
})

describe("Memba OS theme", () => {
    it("follows the system while the preference is auto", () => {
        expect(resolveTheme("auto", true)).toBe("dark")
        expect(resolveTheme("auto", false)).toBe("light")
    })

    it("lets an explicit choice win over the system", () => {
        expect(resolveTheme("light", true)).toBe("light")
        expect(resolveTheme("dark", false)).toBe("dark")
    })

    it("stores only explicit choices, per device", () => {
        writeThemePref("dark")
        expect(localStorage.getItem(OS_THEME_KEY)).toBe("dark")
        expect(readThemePref()).toBe("dark")
        writeThemePref("auto")
        expect(localStorage.getItem(OS_THEME_KEY)).toBeNull()
        expect(readThemePref()).toBe("auto")
    })

    it("ignores junk and falls back to auto", () => {
        localStorage.setItem(OS_THEME_KEY, "neon")
        expect(readThemePref()).toBe("auto")
    })

    it("survives storage that throws (private windows)", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
        expect(readThemePref()).toBe("auto")
        expect(() => writeThemePref("dark")).not.toThrow()
    })
})

describe("Memba OS wallpapers", () => {
    it("has five, each with a light and a dark rendering", () => {
        expect(WALLPAPERS).toHaveLength(5)
        WALLPAPERS.forEach((w) => {
            expect(w.light).toBeTruthy()
            expect(w.dark).toBeTruthy()
            expect(w.light).not.toBe(w.dark)
        })
    })

    it("falls back to the default for unknown ids", () => {
        expect(getWallpaper("lagoon").id).toBe("lagoon")
        expect(getWallpaper("gone")).toBe(DEFAULT_WALLPAPER)
        expect(getWallpaper(null)).toBe(DEFAULT_WALLPAPER)
    })
})
