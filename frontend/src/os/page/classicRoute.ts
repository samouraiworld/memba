/**
 * Classic pages inside Memba OS windows: which window a classic path belongs
 * to, and back. An app window's section is its classic page with the app's
 * first route segment dropped when that still round-trips (feed/post/12 →
 * /os/feed/post/12), otherwise the classic path as is.
 *
 * @module os/page/classicRoute
 */
import { isNetworkKey } from "../../lib/config"
import { parseDaoSplat } from "../../lib/daoSlug"
import { getApp, OS_APPS, type OsApp, type OsAppId } from "../apps"
import { nameForRealm } from "../daos/daoNames"
import type { OsTarget } from "../shell/osPath"
import { urlForWindow } from "../shell/windows"

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

/**
 * The window for a classic DAO page. A page the DAO windows don't have (settings,
 * channels, …) opens as itself in a DAOs window, at the normalised realm path
 * (a legacy "~" link included); a weighted DAO's classic pages are all its folder.
 */
function daoTarget(splat: string, weighted = false): OsTarget | null {
    const { realmPath, subRoute } = parseDaoSplat(splat)
    const name = realmPath ? nameForRealm(realmPath) : null
    if (!name) return null
    const [sub, n] = subRoute.split("/")
    if ((sub === "proposal" || sub === "proposals") && n && /^\d{1,9}$/.test(n)) return { kind: "proposal", dao: name, n: Number(n) }
    if (sub === "propose") return { kind: "new-proposal", dao: name }
    if (sub === "proposals" || sub === "members" || sub === "treasury") return { kind: "dao", name, section: sub }
    if (weighted || sub === "" || sub === "proposal") return { kind: "dao", name, section: "overview" }
    return { kind: "app", app: "daos", section: `dao/${realmPath}/${subRoute}` }
}

/**
 * The Memba OS window for a classic URL (`/<network>/<page>`), or null when it
 * has none (another network, a callback, an unknown page): those leave Memba OS.
 */
export function osTargetForClassic(pathname: string, network: string): OsTarget | null {
    if (pathname === "/" || pathname === "") return { kind: "desktop" }
    const m = /^\/([^/?#]+)\/?([^?#]*)/.exec(pathname)
    if (!m || !isNetworkKey(network)) return null
    // A bare legacy path (/validators/hacker) gets the current network, as LegacyRedirect does.
    if (!isNetworkKey(m[1])) return pathname.startsWith("/os/") || pathname === "/os" ? null : osTargetForClassic(`/${network}${pathname}`, network)
    if (m[1] !== network) return null
    const rest = m[2].replace(/\/+$/, "")
    if (rest === "dashboard") return { kind: "desktop" }
    if (rest === "") return { kind: "app", app: "wallet", section: null }
    if (rest === "feedback") return { kind: "feedback" }
    if (rest === "dao") return { kind: "app", app: "daos", section: null }
    if (rest === "dao/create") return { kind: "app", app: "daos", section: "new" }
    if (rest.startsWith("dao/")) return daoTarget(rest.slice(4))
    // A weighted DAO's classic page is its DAO folder here.
    if (rest.startsWith("weighted-dao/")) return daoTarget(rest.slice("weighted-dao/".length), true)
    const ms = /^multisig\/([^/]+)$/.exec(rest)
    if (ms && ADDRESS.test(ms[1])) return { kind: "multisig", address: ms[1] }
    const app = OS_APPS.find((a) => owns(a, rest))
    if (!app) return null
    // The page's own query rides with its window (w is reserved for the other windows).
    const search = /\?([^#]*)/.exec(pathname)
    const params = new URLSearchParams(search?.[1] ?? "")
    params.delete("w")
    return { kind: "app", app: app.id, section: sectionForClassic(app.id, rest), ...(search ? { query: params.toString() } : {}) }
}

/**
 * The /os URL a classic URL opens on a Memba OS build, or null when it stays a
 * classic page: no window for it, or a network hidden from the selector (a
 * testnet or a dead chain is reached by explicit link only, and Memba OS
 * would not stay on it). `network` is the network the page loaded with.
 */
export function osUrlForClassic(pathname: string, network: string): string | null {
    if (!NETWORKS[network] || NETWORKS[network].hidden) return null
    // The classic home is the Wallet window inside Memba OS; an address of its own opens the desktop.
    if (/^\/[^/?#]+\/*(?:[?#]|$)/.test(pathname) && pathname.split(/[/?#]/)[1] === network) return "/os"
    const target = osTargetForClassic(pathname, network)
    return target ? urlForWindow({ target }) : null
}

/** Pages that send a guest away in the classic app (they need a signed-in wallet): the window asks to connect instead.
 *  Creating, importing and proposing a multisig are not here: those pages show a guest their form with its own connect prompt.
 *  Nor are the App Store's submit, curator queue and own-listings pages: the native store window serves them, guests included. */
export function pageNeedsWallet(page: string): boolean {
    return page === "profile" || page === "multisig"
}
