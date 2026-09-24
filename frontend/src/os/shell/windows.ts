/**
 * The window manager's state: open (or refocus an already-open key), focus,
 * move, resize, minimise, maximise, tile, next, close. Geometry is in px
 * relative to the desk (the area under the menu bar); the reducer is pure and
 * takes the desk size from the action, so it is testable without a DOM.
 *
 * @module os/shell/windows
 */
import { useCallback, useReducer } from "react"
import { getApp, type OsAppId } from "../apps"
import type { DaoSection, OsTarget } from "./osPath"

export interface OsWindow {
    id: string
    /** Identity: opening the same key again focuses the existing window. */
    key: string
    title: string
    app: OsAppId | null
    x: number
    y: number
    width: number
    height: number
    z: number
    min: boolean
    max: boolean
    target: OsTarget | null
}

/** What opening a window needs; geometry is placed by the reducer. */
export interface WindowSpec {
    key: string
    title: string
    app: OsAppId | null
    width: number
    height: number
    target: OsTarget | null
}

export interface DeskSize { w: number; h: number }

/** Room kept free at the bottom of the desk for the dock. */
export const DOCK_ROOM = 86
const MIN_W = 320
const MIN_H = 220

export function welcomeSpec(): WindowSpec {
    return { key: "welcome", title: "Welcome to Memba", app: null, width: 560, height: 360, target: null }
}

export function appSpec(app: OsAppId, section: string | null = null): WindowSpec {
    // The DAOs app is a native list; the others show a full Memba page for now, so they open larger.
    const [width, height] = app === "daos" ? [480, 400] : [960, 660]
    return { key: `app:${app}`, title: getApp(app).name, app, width, height, target: { kind: "app", app, section } }
}

/** The Create DAO wizard (/os/daos/new): its own window, so the DAOs app stays open beside it. */
export function newDaoSpec(): WindowSpec {
    return { key: "flow:dao", title: "Create a DAO", app: "daos", width: 820, height: 560, target: { kind: "app", app: "daos", section: "new" } }
}

export function daoSpec(name: string, section: DaoSection = "overview"): WindowSpec {
    return { key: `dao:${name}`, title: name, app: "daos", width: 560, height: 420, target: { kind: "dao", name, section } }
}

/** The window a link opens (null for the bare desktop). */
export function specForTarget(t: OsTarget): WindowSpec | null {
    switch (t.kind) {
        case "desktop": return null
        case "app": return t.app === "daos" && t.section === "new" ? newDaoSpec() : appSpec(t.app, t.section)
        case "dao": return daoSpec(t.name, t.section)
        case "proposal": return { key: `prop:${t.dao}:${t.n}`, title: `${t.dao} · Proposal #${t.n}`, app: "daos", width: 460, height: 380, target: t }
        case "new-proposal": return { key: `flow:prop:${t.dao}`, title: `New proposal · ${t.dao}`, app: "daos", width: 760, height: 540, target: t }
        case "multisig": return { key: `msig:${t.address}`, title: `Multisig ${t.address.slice(0, 8)}…${t.address.slice(-4)}`, app: "multisig", width: 540, height: 440, target: t }
        case "feedback": return { key: "feedback", title: "Send feedback", app: null, width: 640, height: 620, target: t }
        case "unknown": return { key: "notfound", title: "Not found", app: null, width: 420, height: 280, target: t }
    }
}

/** The /os URL a window stands for (Copy link, address bar). */
export function urlForWindow(w: Pick<OsWindow, "target">): string {
    const t = w.target
    if (!t) return "/os"
    switch (t.kind) {
        case "app": return `/os/${getApp(t.app).slug}${t.section ? `/${t.section}` : ""}`
        case "dao": return `/os/dao/${encodeURIComponent(t.name)}${t.section === "overview" ? "" : `/${t.section}`}`
        case "proposal": return `/os/dao/${encodeURIComponent(t.dao)}/proposals/${t.n}`
        case "new-proposal": return `/os/dao/${encodeURIComponent(t.dao)}/proposals/new`
        case "multisig": return `/os/multisig/${t.address}`
        case "feedback": return "/os/feedback"
        default: return "/os"
    }
}

export interface WindowsState { top: number; seq: number; wins: OsWindow[] }

export type WindowsAction =
    | { type: "open"; spec: WindowSpec; desk: DeskSize; center?: boolean }
    | { type: "focus"; id: string }
    | { type: "move"; id: string; x: number; y: number; desk: DeskSize }
    | { type: "resize"; id: string; width: number; height: number; desk: DeskSize }
    | { type: "minimise"; id: string }
    | { type: "toggleMax"; id: string }
    | { type: "close"; id: string }
    | { type: "closeKey"; key: string }
    | { type: "closeAll" }
    | { type: "minimiseAll" }
    | { type: "tile"; desk: DeskSize }
    | { type: "next" }
    /** Replace everything (restoring a saved session). */
    | { type: "restore"; wins: OsWindow[] }
    /** Arrive at a URL: see windowsForNavigation. */
    | { type: "navigate"; specs: readonly WindowSpec[]; desk: DeskSize; exact: boolean }

export const EMPTY_WINDOWS: WindowsState = { top: 0, seq: 0, wins: [] }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Keep a title bar reachable: at least 80 px of it on the desk, never above it. */
function keepReachable(x: number, y: number, width: number, desk: DeskSize) {
    return { x: clamp(x, 80 - width, Math.max(0, desk.w - 80)), y: clamp(y, 0, Math.max(0, desk.h - 40)) }
}

function place(spec: WindowSpec, n: number, desk: DeskSize, center: boolean) {
    const width = Math.min(spec.width, Math.max(MIN_W, desk.w - 16))
    const height = Math.min(spec.height, Math.max(MIN_H, desk.h - DOCK_ROOM - 16))
    if (center) return { width, height, x: Math.max(8, Math.round((desk.w - width) / 2)), y: Math.max(8, Math.round((desk.h - DOCK_ROOM - height) / 2)) }
    // Cascade from the top left, as in the mockup, staying clear of the desk items column.
    return {
        width, height,
        x: clamp(60 + (n % 8) * 34, 8, Math.max(8, desk.w - width - 230)),
        y: clamp(22 + (n % 8) * 28, 8, Math.max(8, desk.h - height - DOCK_ROOM)),
    }
}

function raise(s: WindowsState, id: string, patch: Partial<OsWindow> = {}): WindowsState {
    const top = s.top + 1
    return { ...s, top, wins: s.wins.map((w) => (w.id === id ? { ...w, ...patch, z: top } : w)) }
}

export function windowsReducer(s: WindowsState, a: WindowsAction): WindowsState {
    switch (a.type) {
        case "open": {
            const existing = s.wins.find((w) => w.key === a.spec.key)
            // Reopening keeps the window where it is, but follows the link's section.
            if (existing) return raise(s, existing.id, { min: false, target: a.spec.target ?? existing.target })
            const seq = s.seq + 1
            const top = s.top + 1
            const g = place(a.spec, s.wins.length, a.desk, !!a.center)
            return { top, seq, wins: [...s.wins, { ...a.spec, ...g, id: `w${seq}`, z: top, min: false, max: false }] }
        }
        case "focus": {
            const w = s.wins.find((x) => x.id === a.id)
            return w ? raise(s, a.id, { min: false }) : s
        }
        case "move": {
            const w = s.wins.find((x) => x.id === a.id)
            if (!w) return s
            const p = keepReachable(a.x, a.y, w.width, a.desk)
            return { ...s, wins: s.wins.map((x) => (x.id === a.id ? { ...x, ...p, max: false } : x)) }
        }
        case "resize": {
            const w = s.wins.find((x) => x.id === a.id)
            if (!w) return s
            const width = clamp(a.width, MIN_W, Math.max(MIN_W, a.desk.w - w.x - 8))
            const height = clamp(a.height, MIN_H, Math.max(MIN_H, a.desk.h - w.y - 8))
            return { ...s, wins: s.wins.map((x) => (x.id === a.id ? { ...x, width, height, max: false } : x)) }
        }
        case "minimise": return { ...s, wins: s.wins.map((w) => (w.id === a.id ? { ...w, min: true } : w)) }
        case "toggleMax": {
            const w = s.wins.find((x) => x.id === a.id)
            return w ? raise(s, a.id, { max: !w.max, min: false }) : s
        }
        case "close": return { ...s, wins: s.wins.filter((w) => w.id !== a.id) }
        case "closeKey": return { ...s, wins: s.wins.filter((w) => w.key !== a.key) }
        case "closeAll": return { ...s, wins: [] }
        case "minimiseAll": return { ...s, wins: s.wins.map((w) => ({ ...w, min: true })) }
        case "tile": {
            const two = visibleWindows(s.wins).sort((a, b) => b.z - a.z).slice(0, 2)
            if (!two.length) return s
            const half = Math.floor(a.desk.w / two.length)
            const height = Math.max(MIN_H, a.desk.h - DOCK_ROOM - 16)
            const byId = new Map(two.map((w, i) => [w.id, { x: 8 + i * half, y: 8, width: Math.max(MIN_W, half - 16), height, max: false }]))
            return { ...s, wins: s.wins.map((w) => (byId.has(w.id) ? { ...w, ...byId.get(w.id) } : w)) }
        }
        case "next": {
            // Bring the back-most visible window to the front: repeated ⌥` cycles through them all.
            const vis = visibleWindows(s.wins)
            if (vis.length < 2) return s
            const back = vis.reduce((a, b) => (a.z < b.z ? a : b))
            return raise(s, back.id)
        }
        case "navigate": return windowsForNavigation(s, a.specs, a.desk, a.exact)
        case "restore": {
            const top = a.wins.reduce((m, w) => Math.max(m, w.z), 0)
            const seq = a.wins.reduce((m, w) => Math.max(m, Number(w.id.replace(/^w/, "")) || 0), 0)
            return { top, seq, wins: a.wins }
        }
    }
}

/**
 * The windows after navigating to a URL. A link (push) opens its windows on
 * top of the others; back/forward (pop) makes the visible windows exactly the
 * ones the URL lists, so going back really returns to that set. Minimised
 * windows aren't in URLs and are left alone. Windows that stay keep their
 * geometry.
 */
export function windowsForNavigation(s: WindowsState, specs: readonly WindowSpec[], desk: DeskSize, exact: boolean): WindowsState {
    const keys = new Set(specs.map((x) => x.key))
    const kept = exact ? { ...s, wins: s.wins.filter((w) => w.min || keys.has(w.key)) } : s
    return specs.reduce((acc, spec) => windowsReducer(acc, { type: "open", spec, desk }), kept)
}

export function visibleWindows(wins: readonly OsWindow[]): OsWindow[] {
    return wins.filter((w) => !w.min)
}

/** The focused window: the highest visible one. */
export function frontWindow(wins: readonly OsWindow[]): OsWindow | null {
    const vis = visibleWindows(wins)
    return vis.length ? vis.reduce((a, b) => (a.z > b.z ? a : b)) : null
}

export function useWindows(init: () => WindowsState) {
    const [state, dispatch] = useReducer(windowsReducer, undefined, init)
    const focus = useCallback((id: string) => dispatch({ type: "focus", id }), [])
    const close = useCallback((id: string) => dispatch({ type: "close", id }), [])
    const closeKey = useCallback((key: string) => dispatch({ type: "closeKey", key }), [])
    const minimise = useCallback((id: string) => dispatch({ type: "minimise", id }), [])
    const toggleMax = useCallback((id: string) => dispatch({ type: "toggleMax", id }), [])
    const closeAll = useCallback(() => dispatch({ type: "closeAll" }), [])
    const minimiseAll = useCallback(() => dispatch({ type: "minimiseAll" }), [])
    const next = useCallback(() => dispatch({ type: "next" }), [])
    return { state, wins: state.wins, front: frontWindow(state.wins), dispatch, focus, close, closeKey, minimise, toggleMax, closeAll, minimiseAll, next }
}
