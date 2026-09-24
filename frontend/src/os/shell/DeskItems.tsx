/**
 * Desktop items: one click opens (D10), drag snaps to the grid (swapping with
 * an item already there), right-click opens the item or desktop menu.
 *
 * @module os/shell/DeskItems
 */
import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { getApp, type OsAppId } from "../apps"
import { cellPosition, nearestCell, type DeskItem } from "./desk"
import { shortAddr } from "./format"
import { AppTile, ThingTile } from "./icons"

const DAO_TINT = ["#5B7CFA", "#3D5BE0"] as const

function initials(name: string): string {
    const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean)
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

function itemLook(it: DeskItem): { label: string; tile: ReactNode } {
    switch (it.ty) {
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
export function DeskIcon({ item }: { item: DeskItem }) {
    const look = itemLook(item)
    return <>{look.tile}<span className="os-ph-label">{look.label}</span></>
}

type Drag = { index: number; el: HTMLElement; sx: number; sy: number; ox: number; oy: number; moved: boolean }

export function DeskItems({ items, deskWidth, onOpen, onMove, onMenu }: {
    items: readonly DeskItem[]
    deskWidth: number
    onOpen: (index: number) => void
    onMove: (index: number, c: number, r: number) => void
    onMenu: (e: ReactMouseEvent, index: number) => void
}) {
    const drag = useRef<Drag | null>(null)
    const justDragged = useRef(false)

    const down = (index: number, e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return
        const p = cellPosition(items[index].c, items[index].r, deskWidth)
        drag.current = { index, el: e.currentTarget, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false }
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
        onMove(d.index, cell.c, cell.r)
    }

    return (
        <>
            {items.map((it, i) => {
                const { label, tile } = itemLook(it)
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

/** A right-click menu at a desk position; closes on Escape or any outside press. */
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: (MenuEntry | "sep")[]; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
        window.addEventListener("keydown", onKey)
        window.addEventListener("pointerdown", onDown)
        ref.current?.querySelector<HTMLButtonElement>("button")?.focus()
        return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown) }
    }, [onClose])
    return (
        <div ref={ref} className="os-ctx os-glass os-menu" role="menu" style={{ left: x, top: y }}>
            {entries.map((e, i) => e === "sep"
                ? <div key={i} className="os-msep" role="separator" />
                : <button key={i} type="button" role="menuitem" className="os-mi" onClick={() => { onClose(); e.run() }}><span>{e.label}</span></button>)}
        </div>
    )
}
