/**
 * appStore — read-only client for the memba_appstore_v2 realm (W9 App Store).
 *
 * Reads the realm's JSON getters (`ListLiveJSON`, `GetListingJSON`) via ABCI
 * `vm/qeval` and parses them. Read-only: the money path (RegisterApp) is a wallet
 * broadcast handled elsewhere; this module never writes.
 *
 * SECURITY: `pkgPath` reaches `GetListingJSON(...)` inside a qeval EXPRESSION, so
 * it is validated against a strict realm-path shape before interpolation — an
 * unsanitized value could inject arbitrary gno into the evaluated expression.
 *
 * @module lib/appStore
 */

import { queryEval, parseQevalJSON } from "./dao/shared"
import { GNO_RPC_URL } from "./config"

export const APPSTORE_REALM_PATH = "gno.land/r/samcrew/memba_appstore_v2"

export interface AppListing {
    id: number
    pkgPath: string
    name: string
    tagline: string
    category: string
    iconCID: string
    appURL: string
    publisher: string
    status: string
    flagCount: number
    createdAt: number
    descr?: string
}

/** A safe gno.land realm/package path — the only shape we'll put in a qeval expr. */
const REALM_PATH_RE = /^gno\.land\/[rp]\/[a-zA-Z0-9_./-]+$/

export function isSafeRealmPath(p: string): boolean {
    return REALM_PATH_RE.test(p) && p.length <= 200
}

function coerce(o: unknown): AppListing | null {
    if (!o || typeof o !== "object") return null
    const r = o as Record<string, unknown>
    if (typeof r.pkgPath !== "string" || typeof r.name !== "string") return null
    // Defense-in-depth: fetchLiveApps maps coerce and AppDetail cross-links to
    // /explorer/{pkgPath}, so drop any listing whose pkgPath isn't a safe realm path.
    if (!isSafeRealmPath(r.pkgPath)) return null
    const str = (v: unknown): string => (typeof v === "string" ? v : "")
    return {
        id: Number(r.id) || 0,
        pkgPath: r.pkgPath,
        name: r.name,
        tagline: str(r.tagline),
        category: str(r.category),
        iconCID: str(r.iconCID),
        appURL: str(r.appURL),
        publisher: str(r.publisher),
        status: str(r.status),
        flagCount: Number(r.flagCount) || 0,
        createdAt: Number(r.createdAt) || 0,
        descr: typeof r.descr === "string" ? r.descr : undefined,
    }
}

/** Fetch a bounded window of live listings. Returns [] on any error/empty realm. */
export async function fetchLiveApps(offset: number, limit: number): Promise<AppListing[]> {
    const raw = await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, `ListLiveJSON(${offset | 0}, ${limit | 0})`)
    if (!raw) return []
    const parsed = parseQevalJSON(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(coerce).filter((x): x is AppListing => x !== null)
}

/** Fetch one listing by package path, or null if missing / path is unsafe. */
export async function fetchApp(pkgPath: string): Promise<AppListing | null> {
    if (!isSafeRealmPath(pkgPath)) return null
    // pkgPath is validated above; JSON.stringify also escapes it as a gno string literal.
    const raw = await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, `GetListingJSON(${JSON.stringify(pkgPath)})`)
    if (!raw) return null
    return coerce(parseQevalJSON(raw))
}
