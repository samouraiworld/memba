/**
 * Memba OS root — mounted at /os/* when VITE_MEMBA_OS is on (see flag.ts).
 * Paints the Aqua wallpaper in the resolved theme and mounts the shell
 * (menu bar, windows, dock, connect flow) on top of it.
 *
 * @module os/OsRoot
 */
import "./os.css"
import "./shell/shell.css"
import "./kit/kit.css"
import { Shell } from "./shell/Shell"
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
            <Shell />
        </div>
    )
}
