import { DOCK_APPS, type OsAppId } from "../apps"
import { AppTile, ThingTile } from "./icons"
import type { OsWindow } from "./windows"

function WindowTile({ w }: { w: OsWindow }) {
    if (w.app && w.target?.kind === "app") return <AppTile app={w.app} size={44} />
    if (w.target?.kind === "dao") return <ThingTile icon="folder" tint={["#5B7CFA", "#3D5BE0"]} size={44} />
    if (w.target?.kind === "proposal") return <ThingTile icon="doc" size={44} />
    return <AppTile app={w.app ?? "settings"} size={44} />
}

/**
 * The dock (mockup v4 .dock): the default apps, a separator, Settings, then
 * one button per minimised window. A dot marks apps with an open window.
 */
export function Dock({ wins, openApp, restore }: { wins: readonly OsWindow[]; openApp: (app: OsAppId) => void; restore: (id: string) => void }) {
    const running = new Set(wins.map((w) => w.app))
    const item = (id: OsAppId, name: string) => (
        <button key={id} type="button" className={`os-dk${running.has(id) ? " os-run" : ""}`} aria-label={name} onClick={() => openApp(id)}>
            <AppTile app={id} size={44} />
            <span className="os-tip" aria-hidden="true">{name}</span>
        </button>
    )
    const minimised = wins.filter((w) => w.min)
    return (
        <nav className="os-dock" aria-label="Dock">
            {DOCK_APPS.map((a) => item(a.id, a.name))}
            <span className="os-dsep" aria-hidden="true" />
            {item("settings", "Settings")}
            {minimised.map((w) => (
                <button key={w.id} type="button" className="os-dk" aria-label={`Restore ${w.title}`} onClick={() => restore(w.id)}>
                    <WindowTile w={w} />
                    <span className="os-tip" aria-hidden="true">{w.title}</span>
                </button>
            ))}
        </nav>
    )
}
