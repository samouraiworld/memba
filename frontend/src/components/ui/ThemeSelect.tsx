import { useSyncExternalStore } from "react"
import { getThemePreference, setTheme, subscribeTheme, type ThemePreference } from "../../lib/themeStore"
import "./theme-select.css"

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
