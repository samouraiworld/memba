/**
 * Memba OS root — mounted at /os/* when VITE_MEMBA_OS is on (see flag.ts).
 * Paints the Aqua wallpaper in the resolved theme and mounts the shell
 * (menu bar, windows, dock, connect flow) on top of it.
 *
 * @module os/OsRoot
 */
import "./os-fonts.css"
import "./os.css"
import "./shell/shell.css"
import "./classic-bridge.css"
import "./kit/kit.css"
import { Shell } from "./shell/Shell"
import { AppearanceContext, useAppearanceState } from "./appearance"
import { useClassicThemeSync } from "./theme"

export default function OsRoot() {
    const appearance = useAppearanceState()
    useClassicThemeSync(appearance.theme)
    return (
        <div
            className="memba-os"
            data-testid="memba-os"
            data-os-theme={appearance.theme}
            data-os-wallpaper={appearance.wallpaper.id}
            data-os-icon-size={appearance.iconSize}
            style={{ background: appearance.theme === "dark" ? appearance.wallpaper.dark : appearance.wallpaper.light }}
        >
            <AppearanceContext.Provider value={appearance}><Shell /></AppearanceContext.Provider>
        </div>
    )
}
