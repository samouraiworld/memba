/**
 * Desktop items (D6): your things (DAOs, multisigs, bookmarked proposals)
 * and the apps you pin, on a grid anchored to the right edge as in mockup v4.
 * Stored in this browser (D3), one desk per wallet address; guests start from
 * the built-in featured desk (D14) until memba_dao can set it on chain.
 *
 * @module os/shell/desk
 */
import { OS_APPS } from "../apps"
import { parseOsPath, type OsTarget } from "./osPath"

export type DeskItemType = "app" | "dao" | "prop" | "msig"

export interface DeskItem {
    ty: DeskItemType
    /** app id · DAO name · "dao:n" · multisig address */
    ref: string
    c: number
    r: number
}

export const GRID = { colW: 96, rowH: 104, right: 24, top: 14, cols: 8, rows: 6 }

/** Built-in guest desk (D14) until memba_dao sets one by proposal. */
export const FEATURED_DESK: readonly DeskItem[] = [
    { ty: "dao", ref: "govdao", c: 0, r: 0 },
    { ty: "dao", ref: "memba_dao", c: 0, r: 1 },
    { ty: "app", ref: "arcade", c: 0, r: 2 },
]

export function deskKey(address: string | null): string {
    return `memba_os_desk:${address || "guest"}`
}

/** What an item opens, validated like a typed link. Null if the item is malformed. */
export function itemTarget(it: Pick<DeskItem, "ty" | "ref">): OsTarget | null {
    let t: OsTarget
    switch (it.ty) {
        case "app": {
            const app = OS_APPS.find((a) => a.id === it.ref)
            return app ? { kind: "app", app: app.id, section: null } : null
        }
        case "dao": t = parseOsPath(`/os/dao/${it.ref}`); break
        case "prop": {
            const [dao, n] = it.ref.split(":")
            t = parseOsPath(`/os/dao/${dao}/proposals/${n}`)
            break
        }
        case "msig": t = parseOsPath(`/os/multisig/${it.ref}`); break
        default: return null
    }
    return t.kind === "unknown" || t.kind === "desktop" ? null : t
}

/** The item a window would pin, if it is pinnable. */
export function itemForTarget(t: OsTarget | null): Pick<DeskItem, "ty" | "ref"> | null {
    if (!t) return null
    switch (t.kind) {
        case "app": return { ty: "app", ref: t.app }
        case "dao": return { ty: "dao", ref: t.name }
        case "proposal": return { ty: "prop", ref: `${t.dao}:${t.n}` }
        case "multisig": return { ty: "msig", ref: t.address }
        default: return null
    }
}

export function sameItem(a: Pick<DeskItem, "ty" | "ref">, b: Pick<DeskItem, "ty" | "ref">): boolean {
    return a.ty === b.ty && a.ref === b.ref
}

/** The first free cell, column by column from the right edge. */
export function freeSlot(items: readonly DeskItem[], rows = GRID.rows): { c: number; r: number } {
    for (let c = 0; c < GRID.cols; c++) for (let r = 0; r < rows; r++) if (!items.some((i) => i.c === c && i.r === r)) return { c, r }
    return { c: 0, r: 0 }
}

export function addItem(items: readonly DeskItem[], item: Pick<DeskItem, "ty" | "ref">, rows = GRID.rows): DeskItem[] {
    if (items.some((i) => sameItem(i, item))) return [...items]
    return [...items, { ...item, ...freeSlot(items, rows) }]
}

export function removeItem(items: readonly DeskItem[], index: number): DeskItem[] {
    return items.filter((_, i) => i !== index)
}

/** Drop an item on a cell; an item already there swaps into the dragged item's old cell. */
export function moveItem(items: readonly DeskItem[], index: number, c: number, r: number): DeskItem[] {
    const me = items[index]
    if (!me) return [...items]
    const cc = Math.max(0, Math.min(GRID.cols - 1, c))
    const rr = Math.max(0, Math.min(GRID.rows - 1, r))
    return items.map((it, i) => {
        if (i === index) return { ...it, c: cc, r: rr }
        if (it.c === cc && it.r === rr) return { ...it, c: me.c, r: me.r }
        return it
    })
}

/** "Clean up icons": pack items into columns from the right edge, in order. */
export function cleanUp(items: readonly DeskItem[], rows = 5): DeskItem[] {
    return items.map((it, i) => ({ ...it, c: Math.floor(i / rows), r: i % rows }))
}

/** Pixel position of a cell on a desk of the given width. */
export function cellPosition(c: number, r: number, deskWidth: number): { x: number; y: number } {
    return { x: deskWidth - GRID.right - (c + 1) * GRID.colW, y: GRID.top + r * GRID.rowH }
}

/** The cell nearest to a pixel position (inverse of cellPosition). */
export function nearestCell(x: number, y: number, deskWidth: number): { c: number; r: number } {
    return {
        c: Math.max(0, Math.min(GRID.cols - 1, Math.round((deskWidth - GRID.right - x) / GRID.colW - 1))),
        r: Math.max(0, Math.min(GRID.rows - 1, Math.round((y - GRID.top) / GRID.rowH))),
    }
}

const TYPES: readonly DeskItemType[] = ["app", "dao", "prop", "msig"]

export function loadDesk(address: string | null): DeskItem[] {
    try {
        const raw = localStorage.getItem(deskKey(address))
        if (raw === null) return address ? [] : FEATURED_DESK.map((i) => ({ ...i }))
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.slice(0, GRID.cols * GRID.rows).flatMap((e: Partial<DeskItem>) => {
            if (!e || !TYPES.includes(e.ty as DeskItemType) || typeof e.ref !== "string") return []
            const item = { ty: e.ty as DeskItemType, ref: e.ref }
            if (!itemTarget(item)) return []
            const c = Number.isInteger(e.c) ? Math.max(0, Math.min(GRID.cols - 1, e.c as number)) : 0
            const r = Number.isInteger(e.r) ? Math.max(0, Math.min(GRID.rows - 1, e.r as number)) : 0
            return [{ ...item, c, r }]
        })
    } catch {
        return address ? [] : FEATURED_DESK.map((i) => ({ ...i }))
    }
}

export function saveDesk(address: string | null, items: readonly DeskItem[]): void {
    try {
        localStorage.setItem(deskKey(address), JSON.stringify(items))
    } catch {
        // Storage refused: changes last for this visit only.
    }
}
