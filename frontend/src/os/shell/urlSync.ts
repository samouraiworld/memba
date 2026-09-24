/**
 * Windows ⇄ URL. The path is the front window (plan rev 4 URL scheme); the
 * other open windows ride in `?w=`, one token each: app.feed, dao.memba_dao,
 * prop.memba_dao.12, msig.g1…. A token is read back through parseOsPath, so
 * it gets exactly the same validation as a typed link.
 *
 * Also the saved session: the open windows of this browser, restored on a
 * plain /os visit (a link always wins over the saved session).
 *
 * @module os/shell/urlSync
 */
import { getApp, OS_APPS } from "../apps"
import { parseOsPath, type OsTarget } from "./osPath"
import { frontWindow, urlForWindow, visibleWindows, type OsWindow } from "./windows"

/** The ?w= token for a window, or null for windows that aren't linkable (Welcome, not found). */
export function windowToken(t: OsTarget | null): string | null {
    if (!t) return null
    switch (t.kind) {
        case "app": return t.app === "daos" && t.section === "new" ? "newdao" : t.app === "wallet" && t.section === "send" ? "send" : `app.${getApp(t.app).slug}`
        case "dao": return `dao.${t.name}`
        case "proposal": return `prop.${t.dao}.${t.n}`
        case "new-proposal": return `newprop.${t.dao}`
        case "multisig": return `msig.${t.address}`
        case "feedback": return "feedback"
        default: return null
    }
}

export function tokenToTarget(token: string): OsTarget | null {
    if (token === "newdao") return parseOsPath("/os/daos/new")
    if (token === "feedback") return { kind: "feedback" }
    if (token === "send") return parseOsPath("/os/wallet/send")
    const dot = token.indexOf(".")
    if (dot < 1) return null
    const kind = token.slice(0, dot)
    const rest = token.slice(dot + 1)
    let path: string | null = null
    if (kind === "app" && OS_APPS.some((a) => a.slug === rest)) path = `/os/${rest}`
    else if (kind === "dao") path = `/os/dao/${rest}`
    else if (kind === "msig") path = `/os/multisig/${rest}`
    else if (kind === "newprop") path = `/os/dao/${rest}/proposals/new`
    else if (kind === "prop") {
        const last = rest.lastIndexOf(".")
        if (last > 0) path = `/os/dao/${rest.slice(0, last)}/proposals/${rest.slice(last + 1)}`
    }
    if (!path) return null
    const t = parseOsPath(path)
    return t.kind === "desktop" || t.kind === "unknown" ? null : t
}

const MAX_W_TOKENS = 12

/** The windows a URL asks for: the path first (it becomes the front window), then ?w= in order. */
export function targetsFromUrl(pathname: string, search: string): { front: OsTarget; others: OsTarget[] } {
    const front = parseOsPath(pathname)
    const raw = new URLSearchParams(search).get("w") ?? ""
    const others = raw.split(",").filter(Boolean).slice(0, MAX_W_TOKENS)
        .map(tokenToTarget).filter((t): t is OsTarget => t !== null)
    return { front, others }
}

/** The URL for the current windows: the front one's path, the other visible ones in ?w=. */
export function urlForWindows(wins: readonly OsWindow[]): string {
    const front = frontWindow(wins)
    const path = front ? urlForWindow(front) : "/os"
    const others = visibleWindows(wins)
        .filter((w) => w !== front)
        .sort((a, b) => a.z - b.z)
        .map((w) => windowToken(w.target))
        .filter((t): t is string => t !== null)
    return others.length ? `${path}?w=${others.join(",")}` : path
}

// ── saved session ──────────────────────────────────────────────────────────

export const OS_WINDOWS_KEY = "memba_os_windows"

type Saved = Pick<OsWindow, "x" | "y" | "width" | "height" | "z" | "min" | "max"> & { token: string }

export function saveWindows(wins: readonly OsWindow[]): void {
    const saved: Saved[] = wins.flatMap((w) => {
        const token = windowToken(w.target)
        return token ? [{ token, x: w.x, y: w.y, width: w.width, height: w.height, z: w.z, min: w.min, max: w.max }] : []
    })
    try {
        localStorage.setItem(OS_WINDOWS_KEY, JSON.stringify(saved))
    } catch {
        // Storage refused: the session just isn't restored next time.
    }
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback)

/** The saved windows, re-validated (anything malformed is dropped). */
export function loadSavedTargets(): { target: OsTarget; geom: Omit<Saved, "token"> }[] {
    let raw: unknown
    try {
        raw = JSON.parse(localStorage.getItem(OS_WINDOWS_KEY) ?? "[]")
    } catch {
        return []
    }
    if (!Array.isArray(raw)) return []
    return raw.slice(0, MAX_W_TOKENS).flatMap((e: Partial<Saved>) => {
        const target = typeof e?.token === "string" ? tokenToTarget(e.token) : null
        if (!target) return []
        return [{ target, geom: { x: num(e.x, 60), y: num(e.y, 22), width: num(e.width, 480), height: num(e.height, 400), z: num(e.z, 1), min: e.min === true, max: e.max === true } }]
    })
}
