/**
 * Memba OS root — mounted at /os/* when VITE_MEMBA_OS is on (see flag.ts).
 * Day 1 renders the empty Aqua desktop in the resolved theme; the shell,
 * windows and apps land on top of it in the following PRs.
 *
 * @module os/OsRoot
 */
import "./os.css"
import { useOsTheme } from "./theme"
import { DEFAULT_WALLPAPER } from "./wallpapers"

export default function OsRoot() {
    const theme = useOsTheme()
    const wallpaper = DEFAULT_WALLPAPER
    return (
        <div
            className="memba-os"
            data-testid="memba-os"
            data-os-theme={theme}
            style={{ background: theme === "dark" ? wallpaper.dark : wallpaper.light }}
        >
            <header className="os-menubar" aria-label="Menu bar">
                <span className="os-mark" aria-hidden="true" />
                <span>Memba</span>
            </header>
            <main aria-label="Desktop" />
        </div>
    )
}
