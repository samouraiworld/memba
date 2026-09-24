/**
 * Classic pages inside Memba OS windows: which window a classic path belongs
 * to, and back. An app window's section is its classic page with the app's
 * first route segment dropped when that still round-trips (feed/post/12 →
 * /os/feed/post/12), otherwise the classic path as is.
 *
 * @module os/page/classicRoute
 */
import { NETWORKS } from "../../lib/config"
import { parseDaoSplat } from "../../lib/daoSlug"
import { getApp, OS_APPS, type OsApp, type OsAppId } from "../apps"
import { nameForRealm } from "../daos/daoNames"
import type { OsTarget } from "../shell/osPath"

const ADDRESS = /^g1[02-9ac-hj-np-z]{38}$/

/** A route pattern as App's route table writes it (`:param`, trailing `*`) against a path. */
export function matchRoute(pattern: string, path: string): boolean {
    const p = pattern.split("/").filter(Boolean)
    const s = path.split("/").filter(Boolean)
    for (let i = 0; i < p.length; i++) {
        if (p[i] === "*") return i === p.length - 1
        if (i >= s.length) return false
        if (p[i].startsWith(":")) continue
        if (p[i] !== s[i]) return false
    }
    return p.length === s.length
}

/** The page an app opens on, relative to /:network (null: none yet). */
export function classicHome(app: OsAppId): string | null {
    if (app === "wallet") return "" // balances live on the home page today
    const route = getApp(app).routes.map((r) => r.replace(/\/\*$/, "")).find((r) => !r.includes(":") && !r.includes("*"))
    return route ?? null
}

function owns(app: OsApp, path: string): boolean {
    return app.routes.some((r) => matchRoute(r, path))
}

function head(app: OsAppId): string | null {
    const home = classicHome(app)
    return home ? home.split("/")[0] : null
}

/** The classic page for an app window's section, or null when the section isn't one of its pages. */
export function classicForSection(app: OsAppId, section: string | null): string | null {
    if (section === null || section === "") return classicHome(app)
    const a = getApp(app)
    const clean = section.replace(/^\/+|\/+$/g, "")
    if (owns(a, clean)) return clean
    const h = head(app)
    if (h && owns(a, `${h}/${clean}`)) return `${h}/${clean}`
    return null
}

/** The window section for a classic page of an app (null: the app's home). */
export function sectionForClassic(app: OsAppId, classic: string): string | null {
    const clean = classic.replace(/^\/+|\/+$/g, "")
    if (clean === classicHome(app)) return null
    const h = head(app)
    if (h && clean.startsWith(`${h}/`)) {
        const short = clean.slice(h.length + 1)
        if (classicForSection(app, short) === clean) return short
    }
    return clean
}

function daoTarget(splat: string): OsTarget | null {
    const { realmPath, subRoute } = parseDaoSplat(splat)
    const name = realmPath ? nameForRealm(realmPath) : null
    if (!name) return null
    const [sub, n] = subRoute.split("/")
    if ((sub === "proposal" || sub === "proposals") && n && /^\d{1,9}$/.test(n)) return { kind: "proposal", dao: name, n: Number(n) }
    if (sub === "propose") return { kind: "new-proposal", dao: name }
    if (sub === "proposals" || sub === "members" || sub === "treasury") return { kind: "dao", name, section: sub }
    return { kind: "dao", name, section: "overview" }
}

/**
 * The Memba OS window for a classic URL (`/<network>/<page>`), or null when it
 * has none (another network, a callback, an unknown page): those leave Memba OS.
 */
export function osTargetForClassic(pathname: string, network: string): OsTarget | null {
    const m = /^\/([^/?#]+)\/?([^?#]*)/.exec(pathname)
    if (!m || !NETWORKS[network]) return null
    // A bare legacy path (/validators/hacker) gets the current network, as LegacyRedirect does.
    if (!NETWORKS[m[1]]) return pathname.startsWith("/os/") || pathname === "/os" ? null : osTargetForClassic(`/${network}${pathname}`, network)
    if (m[1] !== network) return null
    const rest = m[2].replace(/\/+$/, "")
    if (rest === "") return { kind: "app", app: "wallet", section: null }
    if (rest === "feedback") return { kind: "feedback" }
    if (rest === "dao") return { kind: "app", app: "daos", section: null }
    if (rest === "dao/create") return { kind: "app", app: "daos", section: "new" }
    if (rest.startsWith("dao/")) return daoTarget(rest.slice(4))
    const ms = /^multisig\/([^/]+)$/.exec(rest)
    if (ms && ADDRESS.test(ms[1])) return { kind: "multisig", address: ms[1] }
    const app = OS_APPS.find((a) => owns(a, rest))
    return app ? { kind: "app", app: app.id, section: sectionForClassic(app.id, rest) } : null
}

/** Pages that send a guest away in the classic app (they need a signed-in wallet): the window asks to connect instead. */
export function pageNeedsWallet(page: string): boolean {
    return page === "profile" || page === "multisig" || page === "create" || page === "import" || page.startsWith("multisig/")
}
