/**
 * The ⌘K dialog (mockup v4 launcher): one field, results as you type, arrows
 * to move, Enter to open, Escape to close.
 *
 * @module os/shell/Launcher
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react"
import { getSavedDAOsForOrg, FEATURED_DAO } from "../../lib/daoSlug"
import { DAO_REALM_PATH } from "../../lib/config"
import { AppTile, ThingTile } from "./icons"
import type { ChainFamily } from "../../lib/chain/types"
import { launcherResults, type LaunchItem } from "./launchResults"
import { useDialogKeys } from "./useDialogKeys"
import type { WindowSpec } from "./windows"

export function Launcher({ network, family, open, onClose }: { network: string; family?: ChainFamily; open: (spec: WindowSpec) => void; onClose: (restoreFocus: boolean) => void }) {
    const dialogRef = useRef<HTMLDivElement>(null)
    // Two stops: the field and the result list, which can scroll.
    useDialogKeys(dialogRef, true, 'input, [tabindex="0"]', () => onClose(true))
    const [q, setQ] = useState("")
    const [sel, setSel] = useState(0)
    const daos = useMemo(() => {
        const featured = [{ realmPath: FEATURED_DAO.realmPath, name: FEATURED_DAO.name }, { realmPath: DAO_REALM_PATH, name: "Memba DAO" }]
        const saved = getSavedDAOsForOrg(null).filter((d) => !featured.some((f) => f.realmPath === d.realmPath)).map((d) => ({ realmPath: d.realmPath, name: d.name || d.realmPath }))
        return [...featured, ...saved]
    }, [])
    const results = launcherResults(q, { network, family, daos })
    const current = Math.min(sel, Math.max(0, results.length - 1))
    const go = (item: LaunchItem | undefined) => {
        if (!item) return
        onClose(false)
        open(item.spec)
    }

    const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.preventDefault()
            onClose(true)
        }
    }

    return (
        <div className="os-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(true) }}>
            <div ref={dialogRef} className="os-launch os-glass" role="dialog" aria-modal="true" aria-label="Search and commands" onKeyDown={onDialogKeyDown}>
                <input className="os-launch-in" autoFocus value={q} placeholder="Search apps, DAOs, pages, addresses, commands…" aria-label="Search"
                    role="combobox" aria-expanded="true" aria-controls="os-launch-results" aria-activedescendant={results[current] ? `os-lr-${current}` : undefined}
                    onChange={(e) => { setQ(e.target.value); setSel(0) }}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowDown") { e.preventDefault(); setSel((current + 1) % Math.max(1, results.length)) }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setSel((current - 1 + results.length) % Math.max(1, results.length)) }
                        else if (e.key === "Enter") { e.preventDefault(); go(results[current]) }
                    }} />
                <ul className="os-launch-res" id="os-launch-results" role="listbox" aria-label="Results" tabIndex={0}>
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
