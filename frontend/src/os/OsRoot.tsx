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
import { useState } from "react"
import { Shell } from "./shell/Shell"
import { ARCADE_FREE_PLAY_DEPLOYMENT, resolveArcadeFreePlayDeployment } from "./arcadeFreePlayDeployment"
import { AppearanceContext, useAppearanceState } from "./appearance"
import { useClassicThemeSync } from "./theme"

export default function OsRoot() {
    // Keep one configuration reference per host mount; null never acquires storage.
    const [freePlayConfiguration] = useState(() => resolveArcadeFreePlayDeployment(
        ARCADE_FREE_PLAY_DEPLOYMENT, () => window.localStorage,
    ))
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
            <AppearanceContext.Provider value={appearance}><Shell freePlayConfiguration={freePlayConfiguration} /></AppearanceContext.Provider>
        </div>
    )
}
