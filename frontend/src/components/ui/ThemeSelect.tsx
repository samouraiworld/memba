import { useSyncExternalStore } from "react"
import { Moon, Sun } from "@phosphor-icons/react"
import { getTheme, getThemePreference, setTheme, subscribeTheme, toggleTheme, type ThemePreference } from "../../lib/themeStore"
import "./theme-select.css"

/** A quiet header shortcut; System remains available in appearance settings. */
export function ThemeToggle() {
    const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "dark" as const)
    const label = theme === "dark" ? "Switch to Light theme" : "Switch to Black theme"
    const Icon = theme === "dark" ? Sun : Moon
    return (
        <button type="button" className="k-theme-toggle" aria-label={label} title={label} onClick={toggleTheme}>
            <Icon size={20} weight="regular" aria-hidden="true" />
        </button>
    )
}

/** Native select keeps the same preference control keyboard-accessible everywhere. */
export function ThemeSelect({ onSelect }: { onSelect?: () => void }) {
    const preference = useSyncExternalStore(subscribeTheme, getThemePreference, () => "system" as const)
    return (
        <select
            className="k-theme-select"
            aria-label="Theme"
            value={preference}
            onChange={event => {
                setTheme(event.target.value as ThemePreference)
                onSelect?.()
            }}
        >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Black</option>
        </select>
    )
}
