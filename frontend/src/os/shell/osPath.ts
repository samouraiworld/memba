/**
 * Parses a Memba OS URL into what it opens (plan rev 4, "URL scheme"):
 *   /os                                   desktop
 *   /os/<app>[/<section>]                 an app, e.g. /os/wallet
 *   /os/dao/<name>[/proposals|treasury|members]  a DAO folder
 *   /os/dao/<name>/proposals/<n>          a proposal
 *   /os/dao/<name>/proposals/new          the New proposal wizard
 *   /os/multisig/<address>                a multisig
 * Anything else is "unknown" and opens the not-found window.
 *
 * @module os/shell/osPath
 */
import { classicForSection } from "../page/classicRoute"
import { OS_APPS, type OsAppId } from "../apps"

export type DaoSection = "overview" | "proposals" | "treasury" | "members"

export type OsTarget =
    | { kind: "desktop" }
    /** `query`: the Memba page's own query string (no "?"), for app windows that show a page.
     *  Undefined means "no opinion" (a ?w= token, the dock): reopening keeps the window's current one. */
    | { kind: "app"; app: OsAppId; section: string | null; query?: string }
    | { kind: "dao"; name: string; section: DaoSection }
    | { kind: "proposal"; dao: string; n: number }
    | { kind: "new-proposal"; dao: string }
    | { kind: "multisig"; address: string }
    | { kind: "feedback" }
    | { kind: "unknown"; path: string }

const DAO_NAME = /^[A-Za-z0-9_.-]{1,64}$/
const PROPOSAL_N = /^\d{1,9}$/
const ADDRESS = /^g1[02-9ac-hj-np-z]{38}$/
const SECTIONS: readonly DaoSection[] = ["proposals", "treasury", "members"]

function decode(seg: string): string | null {
    try {
        return decodeURIComponent(seg)
    } catch {
        return null
    }
}

export function parseOsPath(pathname: string): OsTarget {
    const parts = pathname.split("/").filter(Boolean)
    if (parts[0] !== "os") return { kind: "unknown", path: pathname }
    const segs = parts.slice(1).map(decode)
    if (segs.some((s) => s === null)) return { kind: "unknown", path: pathname }
    const [first, second, third, fourth, ...rest] = segs as string[]
    if (!first) return { kind: "desktop" }

    if (first === "dao") {
        if (!second || !DAO_NAME.test(second) || rest.length) return { kind: "unknown", path: pathname }
        if (!third) return { kind: "dao", name: second, section: "overview" }
        if (third === "proposals" && fourth === "new") return { kind: "new-proposal", dao: second }
        if (third === "proposals" && fourth !== undefined) {
            return PROPOSAL_N.test(fourth) ? { kind: "proposal", dao: second, n: Number(fourth) } : { kind: "unknown", path: pathname }
        }
        const section = SECTIONS.find((s) => s === third)
        return section && fourth === undefined ? { kind: "dao", name: second, section } : { kind: "unknown", path: pathname }
    }

    // /os/multisig/<address> is the multisig window; its other pages (create, …/propose) are Multisig app sections.
    if (first === "multisig" && second !== undefined) {
        if (ADDRESS.test(second) && third === undefined) return { kind: "multisig", address: second }
        const section = [second, third, fourth, ...rest].filter(Boolean).join("/")
        const page = classicForSection("multisig", section)
        // multisig/<x>/… pages need x to be an address.
        const ok = page !== null && (!page.startsWith("multisig/") || ADDRESS.test(second))
        return ok ? { kind: "app", app: "multisig", section } : { kind: "unknown", path: pathname }
    }

    if (first === "feedback") return second === undefined ? { kind: "feedback" } : { kind: "unknown", path: pathname }

    const app = OS_APPS.find((a) => a.slug === first)
    if (!app) return { kind: "unknown", path: pathname }
    return { kind: "app", app: app.id, section: second ? [second, third, fourth, ...rest].filter(Boolean).join("/") : null }
}

/** A deep link is any /os URL that opens something other than the bare desktop. */
export function isDeepLink(target: OsTarget): boolean {
    return target.kind !== "desktop"
}
