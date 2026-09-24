import { DOCK_APPS, type OsAppId } from "../apps"
import { AppTile } from "./icons"
import type { OsWindow } from "./windows"

/** The dock (mockup v4 .dock): the default apps, a separator, Settings. A dot marks running apps. */
export function Dock({ wins, openApp }: { wins: readonly OsWindow[]; openApp: (app: OsAppId) => void }) {
    const running = new Set(wins.map((w) => w.app))
    const item = (id: OsAppId, name: string) => (
        <button key={id} type="button" className={`os-dk${running.has(id) ? " os-run" : ""}`} aria-label={name} onClick={() => openApp(id)}>
            <AppTile app={id} size={44} />
            <span className="os-tip" aria-hidden="true">{name}</span>
        </button>
    )
    return (
        <nav className="os-dock" aria-label="Dock">
            {DOCK_APPS.map((a) => item(a.id, a.name))}
            <span className="os-dsep" aria-hidden="true" />
            {item("settings", "Settings")}
        </nav>
    )
}
