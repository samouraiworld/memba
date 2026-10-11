/**
 * Desktop items: one click opens (D10), drag snaps to the grid (swapping with
 * an item already there), right-click opens the item or desktop menu.
 *
 * @module os/shell/DeskItems
 */
import { useEffect, useId, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { getApp, type OsAppId } from "../apps"
import { cellPosition, nearestCell, sameItem, type DeskItem } from "./desk"
import { shortAddr } from "./format"
import { AppTile, Icon, ThingTile } from "./icons"

const DAO_TINT = ["#5B7CFA", "#3D5BE0"] as const
const NO_PRIVATE_NOTES: ReadonlySet<string> = new Set()

function initials(name: string): string {
    const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean)
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

/** A document with a small Notes badge; a lock instead for a private note. */
function noteTile(isPrivate: boolean): ReactNode {
    return <span className="os-badged"><ThingTile icon="doc" /><span className="os-badge2 os-badge2-note" data-private={isPrivate || undefined}><Icon name={isPrivate ? "lock" : "pen"} /></span></span>
}

function itemLook(it: DeskItem, noteLabels: Readonly<Record<string, string>>, privateNotes: ReadonlySet<string>): { label: string; tile: ReactNode } {
    switch (it.ty) {
        case "note": return { label: noteLabels[it.ref] ?? "Note", tile: noteTile(privateNotes.has(it.ref)) }
        case "app": return { label: getApp(it.ref as OsAppId).name, tile: <AppTile app={it.ref as OsAppId} /> }
        case "dao": return { label: it.ref, tile: <span className="os-badged"><ThingTile icon="folder" tint={DAO_TINT} /><span className="os-badge2">{initials(it.ref)}</span></span> }
        case "prop": {
            const [dao, n] = it.ref.split(":")
            return { label: `#${n} ${dao}`, tile: <span className="os-badged"><ThingTile icon="doc" /><span className="os-badge2 os-badge2-dao">{initials(dao)}</span></span> }
        }
        case "msig": return { label: shortAddr(it.ref), tile: <AppTile app="multisig" /> }
    }
}

/** A desk item's tile and label, for the phone home screen (tap only). */
export function DeskIcon({ item, noteLabels = {}, privateNotes = NO_PRIVATE_NOTES }: { item: DeskItem; noteLabels?: Readonly<Record<string, string>>; privateNotes?: ReadonlySet<string> }) {
    const look = itemLook(item, noteLabels, privateNotes)
    return <>{look.tile}<span className="os-ph-label">{look.label}</span></>
}

type Drag = { target: Pick<DeskItem, "ty" | "ref">; el: HTMLElement; sx: number; sy: number; ox: number; oy: number; moved: boolean }

export function DeskItems({ items, noteLabels = {}, privateNotes = NO_PRIVATE_NOTES, deskWidth, onOpen, onMove, onMenu }: {
    items: readonly DeskItem[]
    noteLabels?: Readonly<Record<string, string>>
    privateNotes?: ReadonlySet<string>
    deskWidth: number
    onOpen: (index: number) => void
    onMove: (index: number, c: number, r: number) => void
    onMenu: (e: ReactMouseEvent, index: number) => void
}) {
    const drag = useRef<Drag | null>(null)
    const justDragged = useRef(false)

    const down = (index: number, e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return
        const item = items[index]; if (!item) return
        const p = cellPosition(item.c, item.r, deskWidth)
        drag.current = { target: { ty: item.ty, ref: item.ref }, el: e.currentTarget, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
    }
    const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        if (!d.moved && Math.hypot(dx, dy) < 5) return
        d.moved = true
        d.el.classList.add("os-dragging")
        d.el.style.left = `${d.ox + dx}px`
        d.el.style.top = `${d.oy + dy}px`
    }
    const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
        const d = drag.current
        drag.current = null
        if (!d?.moved) return
        justDragged.current = true
        d.el.classList.remove("os-dragging")
        Object.assign(d.el.style, { left: `${d.ox}px`, top: `${d.oy}px` }) // React re-renders it into its new cell
        const cell = nearestCell(d.ox + e.clientX - d.sx, d.oy + e.clientY - d.sy, deskWidth)
        const index = items.findIndex(item => sameItem(item, d.target))
        if (index >= 0) onMove(index, cell.c, cell.r)
    }

    return (
        <>
            {items.map((it, i) => {
                const { label, tile } = itemLook(it, noteLabels, privateNotes)
                const p = cellPosition(it.c, it.r, deskWidth)
                return (
                    <button key={`${it.ty}:${it.ref}`} type="button" className="os-thing" style={{ left: p.x, top: p.y } as CSSProperties}
                        data-item={`${it.ty}:${it.ref}`}
                        onPointerDown={(e) => down(i, e)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                        onClick={() => { if (justDragged.current) { justDragged.current = false; return } onOpen(i) }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e, i) }}>
                        {tile}
                        <span className="os-thing-label">{label}</span>
                    </button>
                )
            })}
        </>
    )
}

export interface MenuEntry { label: string; run: () => void }
/** A line of explanation under the entries, not an action. */
export interface MenuHint { hint: string }

/** A right-click menu at a desk position; closes on Escape or any outside press. */
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: (MenuEntry | MenuHint | "sep")[]; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null)
    const opener = useRef<HTMLElement | null>(null)
    const hintId = useId()
    useEffect(() => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault()
                onClose()
                requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus({ preventScroll: true }))
                return
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return
            const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
            if (!items.length) return
            const current = items.indexOf(document.activeElement as HTMLButtonElement)
            const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
                : e.key === "ArrowDown" ? (current + 1) % items.length
                    : (current - 1 + items.length) % items.length
            e.preventDefault()
            items[next].focus()
        }
        const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
        window.addEventListener("keydown", onKey)
        window.addEventListener("pointerdown", onDown)
        ref.current?.querySelector<HTMLButtonElement>("button")?.focus()
        return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown) }
    }, [onClose])
    return (
        <div ref={ref} className="os-ctx os-glass os-menu" role="menu" style={{ left: x, top: y }}>
            {entries.map((e, i) => {
                if (e === "sep") return <div key={i} className="os-msep" role="separator" />
                if ("hint" in e) return <p key={i} id={`${hintId}-${i}`} className="os-mhint">{e.hint}</p>
                // A hint right after an entry describes it for screen readers too.
                const next = entries[i + 1]
                const described = next && next !== "sep" && "hint" in next ? `${hintId}-${i + 1}` : undefined
                return <button key={i} type="button" role="menuitem" className="os-mi" aria-describedby={described} onClick={() => { onClose(); e.run() }}><span>{e.label}</span></button>
            })}
        </div>
    )
}
