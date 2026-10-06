/**
 * The tab strip and panel of a DAO folder window. Arrow keys, Home and End
 * move between tabs; each tab is its own window address.
 *
 * @module os/daos/FolderTabs
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react"
import type { DaoSection } from "../shell/osPath"
import { daoSpec, type WindowSpec } from "../shell/windows"

export function FolderTabs({ name, tabs, section, open, children }: {
    name: string; tabs: readonly { id: DaoSection; label: string }[]; section: DaoSection; open: (spec: WindowSpec) => void; children: ReactNode
}) {
    const refs = useRef<Partial<Record<DaoSection, HTMLButtonElement | null>>>({})
    const tabId = (id: DaoSection) => `os-dao-${name}-${id}`
    const panelId = `os-dao-${name}-panel`
    const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, id: DaoSection) => {
        const index = tabs.findIndex((tab) => tab.id === id)
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
            : event.key === "ArrowRight" ? (index + 1) % tabs.length
                : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : -1
        if (next < 0) return
        event.preventDefault()
        const target = tabs[next].id
        open(daoSpec(name, target))
        requestAnimationFrame(() => refs.current[target]?.focus())
    }
    return (
        <div className="os-folder">
            <div className="os-tabs" role="tablist" aria-label="DAO sections">
                {tabs.map((t) => (
                    <button key={t.id} ref={(node) => { refs.current[t.id] = node }} id={tabId(t.id)} type="button" role="tab" aria-selected={section === t.id}
                        aria-controls={panelId} tabIndex={section === t.id ? 0 : -1} className="os-tab" onKeyDown={(event) => onTabKey(event, t.id)}
                        onClick={() => open(daoSpec(name, t.id))}>{t.label}</button>
                ))}
            </div>
            <div id={panelId} className="os-folder-body" role="tabpanel" aria-labelledby={tabId(section)} tabIndex={0}>
                {children}
            </div>
        </div>
    )
}
