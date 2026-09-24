/**
 * Day-2 window list: open (or focus an already-open key), focus, close.
 * Enough for the Welcome window, dock launches and deep links; dragging,
 * resizing, minimising, spaces and URL sync arrive with the window manager.
 *
 * @module os/shell/windows
 */
import { useCallback, useReducer } from "react"
import { getApp, type OsAppId } from "../apps"
import type { OsTarget } from "./osPath"

export interface OsWindow {
    id: string
    /** Identity: opening the same key again focuses the existing window. */
    key: string
    title: string
    app: OsAppId | null
    width: number
    height: number
    z: number
    target: OsTarget | null
}

export type WindowSpec = Omit<OsWindow, "id" | "z">

export function welcomeSpec(): WindowSpec {
    return { key: "welcome", title: "Welcome to Memba", app: null, width: 560, height: 360, target: null }
}

export function appSpec(app: OsAppId): WindowSpec {
    return { key: `app:${app}`, title: getApp(app).name, app, width: 480, height: 380, target: { kind: "app", app, section: null } }
}

/** The window a deep link opens (null for the bare desktop). */
export function specForTarget(t: OsTarget): WindowSpec | null {
    switch (t.kind) {
        case "desktop": return null
        case "app": return { ...appSpec(t.app), target: t }
        case "dao": return { key: `dao:${t.name}`, title: t.name, app: "daos", width: 560, height: 420, target: t }
        case "proposal": return { key: `prop:${t.dao}:${t.n}`, title: `${t.dao} · Proposal #${t.n}`, app: "daos", width: 460, height: 380, target: t }
        case "multisig": return { key: `msig:${t.address}`, title: `Multisig ${t.address.slice(0, 8)}…${t.address.slice(-4)}`, app: "multisig", width: 540, height: 440, target: t }
        case "unknown": return { key: "notfound", title: "Not found", app: null, width: 420, height: 280, target: t }
    }
}

/** The /os URL a window stands for (Copy link). */
export function urlForWindow(w: Pick<OsWindow, "target">): string {
    const t = w.target
    if (!t) return "/os"
    switch (t.kind) {
        case "app": return `/os/${getApp(t.app).slug}${t.section ? `/${t.section}` : ""}`
        case "dao": return `/os/dao/${encodeURIComponent(t.name)}${t.section === "overview" ? "" : `/${t.section}`}`
        case "proposal": return `/os/dao/${encodeURIComponent(t.dao)}/proposals/${t.n}`
        case "multisig": return `/os/multisig/${t.address}`
        default: return "/os"
    }
}

type State = { top: number; seq: number; wins: OsWindow[] }
type Action =
    | { type: "open"; spec: WindowSpec }
    | { type: "focus"; id: string }
    | { type: "close"; id: string }
    | { type: "closeKey"; key: string }
    | { type: "closeAll" }

export function windowsReducer(s: State, a: Action): State {
    switch (a.type) {
        case "open": {
            const top = s.top + 1
            const existing = s.wins.find((w) => w.key === a.spec.key)
            if (existing) return { ...s, top, wins: s.wins.map((w) => (w === existing ? { ...w, z: top } : w)) }
            const seq = s.seq + 1
            return { top, seq, wins: [...s.wins, { ...a.spec, id: `w${seq}`, z: top }] }
        }
        case "focus": {
            if (!s.wins.some((w) => w.id === a.id)) return s
            const top = s.top + 1
            return { ...s, top, wins: s.wins.map((w) => (w.id === a.id ? { ...w, z: top } : w)) }
        }
        case "close": return { ...s, wins: s.wins.filter((w) => w.id !== a.id) }
        case "closeKey": return { ...s, wins: s.wins.filter((w) => w.key !== a.key) }
        case "closeAll": return { ...s, wins: [] }
    }
}

export function frontWindow(wins: readonly OsWindow[]): OsWindow | null {
    return wins.length ? wins.reduce((a, b) => (a.z > b.z ? a : b)) : null
}

export function useWindows(initial: WindowSpec[] = []) {
    const [state, dispatch] = useReducer(windowsReducer, initial, (specs) =>
        specs.reduce<State>((s, spec) => windowsReducer(s, { type: "open", spec }), { top: 0, seq: 0, wins: [] }))
    const open = useCallback((spec: WindowSpec) => dispatch({ type: "open", spec }), [])
    const focus = useCallback((id: string) => dispatch({ type: "focus", id }), [])
    const close = useCallback((id: string) => dispatch({ type: "close", id }), [])
    const closeKey = useCallback((key: string) => dispatch({ type: "closeKey", key }), [])
    const closeAll = useCallback(() => dispatch({ type: "closeAll" }), [])
    return { wins: state.wins, front: frontWindow(state.wins), open, focus, close, closeKey, closeAll }
}
