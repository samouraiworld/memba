import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { getTheme, getThemePreference, initTheme, setTheme, toggleTheme } from "./themeStore"
let light = false
let stop: (() => void) | undefined
let changes: EventTarget
function changeSystem(value: boolean) { light = value; changes.dispatchEvent(new Event("change")) }
beforeEach(() => {
    light = false
    changes = new EventTarget()
    document.documentElement.removeAttribute("data-theme")
    document.documentElement.removeAttribute("data-theme-preference")
    vi.stubGlobal("matchMedia", vi.fn(() => ({
        get matches() { return light },
        addEventListener: changes.addEventListener.bind(changes),
        removeEventListener: changes.removeEventListener.bind(changes),
    })))
})
afterEach(() => { stop?.(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it("follows the OS at first visit and on changes without storing an override", () => {
    light = true
    stop = initTheme()
    expect(getThemePreference()).toBe("system")
    expect(getTheme()).toBe("light")
    expect(localStorage.getItem("memba_theme")).toBeNull()
    changeSystem(false)
    expect(getTheme()).toBe("dark")
})
it.each(["dark", "light"] as const)("preserves legacy explicit %s", preference => {
    localStorage.setItem("memba_theme", preference)
    stop = initTheme()
    changeSystem(preference !== "light")
    expect(getThemePreference()).toBe(preference)
    expect(getTheme()).toBe(preference)
})
it("returns from an override to System and persists across initialization", () => {
    stop = initTheme()
    setTheme("light")
    changeSystem(false)
    expect(getTheme()).toBe("light")
    setTheme("system")
    expect(getTheme()).toBe("dark")
    stop = initTheme()
    changeSystem(true)
    expect(getThemePreference()).toBe("system")
    expect(getTheme()).toBe("light")
})
it("follows System even when storage reads/writes fail", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    light = true
    stop = initTheme()
    expect(getTheme()).toBe("light")
    setTheme("dark")
    expect(getTheme()).toBe("dark")
    setTheme("system")
    expect(getTheme()).toBe("light")
})
it("syncs cross-tab updates/removal/clear without echoing writes", () => {
    stop = initTheme()
    const write = vi.spyOn(localStorage, "setItem")
    window.dispatchEvent(new StorageEvent("storage", { key: "memba_theme", newValue: "light" }))
    expect(getThemePreference()).toBe("light")
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "dark" }))
    expect(getTheme()).toBe("light")
    window.dispatchEvent(new StorageEvent("storage", { key: "memba_theme", newValue: null }))
    expect(getThemePreference()).toBe("system")
    window.dispatchEvent(new StorageEvent("storage", { key: "memba_theme", newValue: "light" }))
    window.dispatchEvent(new StorageEvent("storage", { key: null }))
    expect(getTheme()).toBe("dark")
    expect(write).not.toHaveBeenCalled()
})
it("ignores sessionStorage updates", () => {
    stop = initTheme()
    window.dispatchEvent(new StorageEvent("storage", { key: "memba_theme", newValue: "light", storageArea: sessionStorage }))
    expect(getThemePreference()).toBe("system")
})
it("falls back for invalid preference and absent matchMedia", () => {
    localStorage.setItem("memba_theme", "invalid")
    vi.stubGlobal("matchMedia", undefined)
    stop = initTheme()
    expect(getThemePreference()).toBe("system")
    expect(getTheme()).toBe("dark")
    setTheme("light")
    expect(getTheme()).toBe("light")
})
it("keeps the existing toggle as a persisted explicit choice", () => {
    stop = initTheme()
    expect(toggleTheme()).toBe("light")
    changeSystem(false)
    expect(getThemePreference()).toBe("light")
    expect(localStorage.getItem("memba_theme")).toBe("light")
})
it("cleans up listeners on reinitialization and disposal", () => {
    stop = initTheme()
    const listener = vi.fn()
    window.addEventListener("memba:theme-change", listener)
    stop = initTheme()
    listener.mockClear()
    changeSystem(true)
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
    changeSystem(false)
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener("memba:theme-change", listener)
})
