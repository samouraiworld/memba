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
import type { AminoMsg } from "./grc20"
import { GNO_RPC_URL } from "./config"

// The active App Store realm. Env-overridable so the front end can be pointed at the v3
// money-path realm (memba_appstore_v3) once it's deployed + migrated, WITHOUT a code change —
// the default stays on the live v2 realm so nothing breaks before that flip.
export const APPSTORE_REALM_PATH =
    import.meta.env.VITE_APPSTORE_REALM_PATH || "gno.land/r/samcrew/memba_appstore_v2"

/**
 * True when the active realm is the v3 realm, which exposes the richer read surface
 * (per-status listing windows via `ListByStatusJSON`, screenshots + `rejectReason` in
 * `GetListingJSON`, publisher windows, curator getters). v3-only UI MUST gate on this so the
 * app never calls a getter the live v2 realm doesn't expose. Flips purely from the env override.
 */
export function isV3Path(path: string): boolean {
    return /_v3$/.test(path)
}
export function isAppStoreV3(): boolean {
    return isV3Path(APPSTORE_REALM_PATH)
}

/** App lifecycle status. The client passes these literals into `ListByStatusJSON` — never free text. */
export type AppStatus = "live" | "pending" | "rejected" | "delisted"

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
    // v3-only fields (absent on v2 → left undefined by coerce).
    rejectReason?: string
    screenshotCIDs?: string[]
    resubmitCount?: number
    paidResubmitCredit?: boolean
}

/** A safe gno.land realm/package path — the only shape we'll put in a qeval expr. */
const REALM_PATH_RE = /^gno\.land\/[rp]\/[a-zA-Z0-9_./-]+$/

export function isSafeRealmPath(p: string): boolean {
    return REALM_PATH_RE.test(p) && p.length <= 200
}

/**
 * FlagApp(pkgPath) — the community report action. One flag per address per
 * listing (the realm dedupes and panics "already flagged"); at the realm's
 * hide threshold the listing drops from the public lists for curator review.
 * Same guard as the read path: pkgPath is validated before it becomes a
 * broadcast argument.
 */
export function buildFlagAppMsg(caller: string, pkgPath: string): AminoMsg {
    if (!isSafeRealmPath(pkgPath)) throw new Error("invalid app path")
    return {
        type: "vm/MsgCall",
        value: { caller, send: "", pkg_path: APPSTORE_REALM_PATH, func: "FlagApp", args: [pkgPath] },
    }
}

function coerce(o: unknown): AppListing | null {
    if (!o || typeof o !== "object") return null
    const r = o as Record<string, unknown>
    if (typeof r.pkgPath !== "string" || typeof r.name !== "string") return null
    // Defense-in-depth: fetchLiveApps maps coerce and AppDetail cross-links to
    // /explorer/{pkgPath}, so drop any listing whose pkgPath isn't a safe realm path.
    if (!isSafeRealmPath(r.pkgPath)) return null
    const str = (v: unknown): string => (typeof v === "string" ? v : "")
    // v3 screenshots arrive as a JSON string array; keep only string CIDs, drop the field if empty.
    const cids = Array.isArray(r.screenshotCIDs)
        ? (r.screenshotCIDs as unknown[]).filter((c): c is string => typeof c === "string")
        : []
    const rejectReason = str(r.rejectReason)
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
        rejectReason: rejectReason || undefined,
        screenshotCIDs: cids.length ? cids : undefined,
        resubmitCount: Number(r.resubmitCount) || 0,
        paidResubmitCredit: r.paidResubmitCredit === true,
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

/**
 * Fetch a bounded window of listings in a given `status` (v3 `ListByStatusJSON`). Returns [] on
 * any error, empty realm, or a realm that doesn't expose the getter (e.g. v2) — so callers can
 * render an empty tab rather than throw. `status` is a fixed enum, but it's still JSON-encoded
 * into the qeval expression as defense-in-depth (never interpolated raw).
 */
export async function fetchByStatus(status: AppStatus, offset: number, limit: number): Promise<AppListing[]> {
    const raw = await queryEval(
        GNO_RPC_URL,
        APPSTORE_REALM_PATH,
        `ListByStatusJSON(${JSON.stringify(status)}, ${offset | 0}, ${limit | 0})`,
    )
    if (!raw) return []
    const parsed = parseQevalJSON(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(coerce).filter((x): x is AppListing => x !== null)
}

/** A bech32 account address — the only shape we'll put in a qeval expr as a publisher. */
const ADDRESS_RE = /^g1[0-9a-z]{10,80}$/

/**
 * Fetch a bounded window of one publisher's listings (v3 `ListByPublisherJSON`) — the
 * My-Submissions read. Returns [] on any error, an address that isn't address-shaped (defense
 * against qeval-expression injection; the value is also JSON-encoded), or a realm without the
 * getter (v2).
 */
export async function fetchByPublisher(publisher: string, offset: number, limit: number): Promise<AppListing[]> {
    if (!ADDRESS_RE.test(publisher)) return []
    const raw = await queryEval(
        GNO_RPC_URL,
        APPSTORE_REALM_PATH,
        `ListByPublisherJSON(${JSON.stringify(publisher)}, ${offset | 0}, ${limit | 0})`,
    )
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
