/**
 * The ⌘K dialog (mockup v4 launcher): one field, results as you type, arrows
 * to move, Enter to open, Escape to close.
 *
 * @module os/shell/Launcher
 */
import { useMemo, useState } from "react"
import { getSavedDAOsForOrg, FEATURED_DAO } from "../../lib/daoSlug"
import { DAO_REALM_PATH } from "../../lib/config"
import { AppTile, ThingTile } from "./icons"
import { launcherResults, type LaunchItem } from "./launchResults"
import type { WindowSpec } from "./windows"

export function Launcher({ network, open, onClose }: { network: string; open: (spec: WindowSpec) => void; onClose: () => void }) {
    const [q, setQ] = useState("")
    const [sel, setSel] = useState(0)
    const daos = useMemo(() => {
        const featured = [{ realmPath: FEATURED_DAO.realmPath, name: FEATURED_DAO.name }, { realmPath: DAO_REALM_PATH, name: "Memba DAO" }]
        const saved = getSavedDAOsForOrg(null).filter((d) => !featured.some((f) => f.realmPath === d.realmPath)).map((d) => ({ realmPath: d.realmPath, name: d.name || d.realmPath }))
        return [...featured, ...saved]
    }, [])
    const results = launcherResults(q, { network, daos })
    const current = Math.min(sel, Math.max(0, results.length - 1))
    const go = (item: LaunchItem | undefined) => {
        if (!item) return
        onClose()
        open(item.spec)
    }

    return (
        <div className="os-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div className="os-launch os-glass" role="dialog" aria-modal="true" aria-label="Search and commands">
                <input className="os-launch-in" autoFocus value={q} placeholder="Search apps, DAOs, pages, addresses, commands…" aria-label="Search"
                    role="combobox" aria-expanded="true" aria-controls="os-launch-results" aria-activedescendant={results[current] ? `os-lr-${current}` : undefined}
                    onChange={(e) => { setQ(e.target.value); setSel(0) }}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") { e.preventDefault(); onClose() }
                        else if (e.key === "ArrowDown") { e.preventDefault(); setSel((current + 1) % Math.max(1, results.length)) }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setSel((current - 1 + results.length) % Math.max(1, results.length)) }
                        else if (e.key === "Enter") { e.preventDefault(); go(results[current]) }
                    }} />
                <ul className="os-launch-res" id="os-launch-results" role="listbox" aria-label="Results">
                    {results.length === 0 && <li className="os-sub os-launch-empty">No match. Try an app, a DAO name, a g1… address or a realm path.</li>}
                    {results.map((r, i) => (
                        <li key={r.id} id={`os-lr-${i}`} role="option" aria-selected={i === current} className="os-launch-r"
                            onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                            {"app" in r.icon ? <AppTile app={r.icon.app} size={30} /> : <ThingTile icon={r.icon.thing} size={30} />}
                            <span className="os-grow"><b className="os-break">{r.title}</b><span className="os-sub os-block">{r.sub}</span></span>
                            <span className="os-sub" aria-hidden="true">{i === current ? "↵" : ""}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}
