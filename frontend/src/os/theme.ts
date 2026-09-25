import { useEffect, useState } from "react"

/** Appearance is per device (D12): stored in this browser only, never synced. */
export type OsThemePref = "auto" | "light" | "dark"
export type OsTheme = "light" | "dark"

export const OS_THEME_KEY = "memba_os_theme"

export function readThemePref(): OsThemePref {
    try {
        const v = localStorage.getItem(OS_THEME_KEY)
        return v === "light" || v === "dark" ? v : "auto"
    } catch {
        return "auto"
    }
}

export function writeThemePref(pref: OsThemePref): void {
    try {
        if (pref === "auto") localStorage.removeItem(OS_THEME_KEY)
        else localStorage.setItem(OS_THEME_KEY, pref)
    } catch {
        // Private windows can refuse storage; the preference then lasts for this visit only.
    }
}

export function resolveTheme(pref: OsThemePref, systemDark: boolean): OsTheme {
    if (pref === "auto") return systemDark ? "dark" : "light"
    return pref
}

const DARK_QUERY = "(prefers-color-scheme: dark)"

function systemPrefersDark(): boolean {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches
}

/** The resolved theme, following the system while the preference is "auto". */
export function useOsTheme(pref: OsThemePref = readThemePref()): OsTheme {
    const [systemDark, setSystemDark] = useState(systemPrefersDark)
    useEffect(() => {
        if (typeof window.matchMedia !== "function") return
        const mq = window.matchMedia(DARK_QUERY)
        const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
        mq.addEventListener("change", onChange)
        return () => mq.removeEventListener("change", onChange)
    }, [])
    return resolveTheme(pref, systemDark)
}

/** The classic pages inside windows read html[data-theme] (lib/themeStore): while Memba OS
 *  is mounted, the OS theme is the only theme. A classic control that sets another one is
 *  overruled at once; the page theme comes back when the OS unmounts. */
export function useClassicThemeSync(theme: OsTheme): void {
    useEffect(() => {
        const root = document.documentElement
        const before = root.getAttribute("data-theme")
        // Idempotent: re-entry from our own dispatch below sees the attribute already
        // matching `theme` and no-ops, so this can never loop.
        const apply = () => {
            if (root.getAttribute("data-theme") !== theme) {
                root.setAttribute("data-theme", theme)
                window.dispatchEvent(new Event("memba:theme-change"))
            }
        }
        apply()
        window.addEventListener("memba:theme-change", apply)
        return () => {
            window.removeEventListener("memba:theme-change", apply)
            if (root.getAttribute("data-theme") !== before) {
                if (before) root.setAttribute("data-theme", before)
                else root.removeAttribute("data-theme")
                window.dispatchEvent(new Event("memba:theme-change"))
            }
        }
    }, [theme])
}
