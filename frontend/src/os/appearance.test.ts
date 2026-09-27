import { afterEach, describe, expect, it, vi } from "vitest"
import { OS_ICON_SIZE_KEY, OS_WALLPAPER_KEY, readIconSize, readWallpaperId } from "./appearance"
import { DEFAULT_WALLPAPER } from "./wallpapers"

afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
})

describe("OS appearance preferences", () => {
    it("ignores stale or invalid wallpaper and icon values", () => {
        localStorage.setItem(OS_WALLPAPER_KEY, "removed-wallpaper")
        localStorage.setItem(OS_ICON_SIZE_KEY, "giant")
        expect(readWallpaperId()).toBe(DEFAULT_WALLPAPER.id)
        expect(readIconSize()).toBe("medium")
    })

    it("can start in a browser that refuses local storage", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
        expect(readWallpaperId()).toBe(DEFAULT_WALLPAPER.id)
        expect(readIconSize()).toBe("medium")
    })
})
