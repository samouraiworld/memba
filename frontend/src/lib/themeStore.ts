/**
 * Theme store — get/set/toggle theme with localStorage persistence.
 *
 * Uses `data-theme` attribute on <html>. Values: "dark" (default) | "light".
 * Respects `prefers-color-scheme` on first visit (no stored preference).
 */

export type Theme = "dark" | "light"

const STORAGE_KEY = "memba_theme"

/** Read the current theme from the DOM. */
export function getTheme(): Theme {
    return (document.documentElement.getAttribute("data-theme") as Theme) || "dark"
}

/** Apply a theme to the DOM and persist it. */
export function setTheme(theme: Theme): void {
    document.documentElement.setAttribute("data-theme", theme)
    try {
        localStorage.setItem(STORAGE_KEY, theme)
    } catch { /* quota */ }
}

/** Toggle between dark and light. Returns the new theme. */
export function toggleTheme(): Theme {
    const next = getTheme() === "dark" ? "light" : "dark"
    setTheme(next)
    window.plausible?.("Theme Toggled", { props: { theme: next } })
    return next
}

/**
 * Initialize theme on app boot. Call once in main.tsx.
 * Priority: localStorage > prefers-color-scheme > dark.
 */
export function initTheme(): void {
    let theme: Theme = "dark"
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored === "light" || stored === "dark") {
            theme = stored
        } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
            theme = "light"
        }
    } catch { /* SSR / no localStorage */ }
    document.documentElement.setAttribute("data-theme", theme)
}
