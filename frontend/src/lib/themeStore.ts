/** Theme preference is separate from the resolved light/dark CSS theme. */
export type Theme = "dark" | "light"
export type ThemePreference = Theme | "system"

const STORAGE_KEY = "memba_theme"
const CHANGE_EVENT = "memba:theme-change"
let dispose: (() => void) | undefined

function parsePreference(value: string | null): ThemePreference {
    return value === "dark" || value === "light" ? value : "system"
}

export function getTheme(): Theme {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"
}

export function getThemePreference(): ThemePreference {
    return parsePreference(document.documentElement.getAttribute("data-theme-preference"))
}

function systemTheme(): Theme {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

function applyPreference(preference: ThemePreference): void {
    const theme = preference === "system" ? systemTheme() : preference
    document.documentElement.setAttribute("data-theme-preference", preference)
    document.documentElement.setAttribute("data-theme", theme)
    window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeTheme(onChange: () => void): () => void {
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CHANGE_EVENT, onChange)
}

/** Legacy explicit values remain compatible with older releases. */
export function setTheme(preference: ThemePreference): void {
    applyPreference(preference)
    try {
        localStorage.setItem(STORAGE_KEY, preference)
    } catch { /* Keep the choice for this session when storage is unavailable. */ }
}

/** The existing command remains a shortcut to an explicit light/dark choice. */
export function toggleTheme(): Theme {
    const next = getTheme() === "dark" ? "light" : "dark"
    setTheme(next)
    window.plausible?.("Theme Toggled", { props: { theme: next } })
    return next
}

/** Initialize once at boot; safe to reinitialize during development. */
export function initTheme(): () => void {
    dispose?.()
    let preference: ThemePreference = "system"
    try {
        preference = parsePreference(localStorage.getItem(STORAGE_KEY))
    } catch { /* Storage failure must not prevent following the OS. */ }
    applyPreference(preference)

    const media = window.matchMedia?.("(prefers-color-scheme: light)")
    const onSystemChange = () => {
        if (getThemePreference() === "system") applyPreference("system")
    }
    const onStorage = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY && event.key !== null) return
        // Ignore sessionStorage events with a coincidentally identical key.
        try {
            if (event.storageArea && event.storageArea !== window.localStorage) return
        } catch { return }
        applyPreference(parsePreference(event.key === null ? null : event.newValue))
    }
    media?.addEventListener("change", onSystemChange)
    window.addEventListener("storage", onStorage)
    dispose = () => {
        media?.removeEventListener("change", onSystemChange)
        window.removeEventListener("storage", onStorage)
    }
    return dispose
}
