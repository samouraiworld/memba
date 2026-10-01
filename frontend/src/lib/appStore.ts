/**
 * appStore — client for the App Store realm (W9; v2 on testnets, v3 on mainnet).
 *
 * Reads the realm's JSON getters (`ListLiveJSON`, `GetListingJSON`) via ABCI
 * `vm/qeval` and parses them, and sends a report (`FlagApp`) at its measured cost.
 * The money path (RegisterApp) is a wallet broadcast handled elsewhere.
 *
 * SECURITY: `pkgPath` reaches `GetListingJSON(...)` inside a qeval EXPRESSION, so
 * it is validated against a strict realm-path shape before interpolation — an
 * unsanitized value could inject arbitrary gno into the evaluated expression.
 *
 * @module lib/appStore
 */

import { queryEval, parseQevalJSON } from "./dao/shared"
import { depositCapUgnot } from "./dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, type AminoMsg } from "./grc20"
import { GNO_RPC_URL, isAppStoreEnabled, isRealmValidOn, MEMBA_DAO } from "./config"

// The active App Store realm, chosen per network in config (MEMBA_DAO.appStorePath).
export const APPSTORE_REALM_PATH = MEMBA_DAO.appStorePath

/**
 * True when the active realm is the v3 realm, which exposes the richer read surface
 * (per-status listing windows via `ListByStatusJSON`, screenshots + `rejectReason` in
 * `GetListingJSON`, publisher windows, curator getters). v3-only UI MUST gate on this so the
 * app never calls a getter the live v2 realm doesn't expose. Follows the per-network path in config.
 */
export function isV3Path(path: string): boolean {
    return /_v3$/.test(path)
}
export function isAppStoreV3(): boolean {
    return isV3Path(APPSTORE_REALM_PATH)
}
/** Reports and the curator queue need the v3 registry on this network: its threshold, reads and measured costs are the ones Memba states. */
export function isAppStoreV3On(networkKey: string): boolean {
    return isAppStoreEnabled() && isAppStoreV3() && isRealmValidOn(networkKey, APPSTORE_REALM_PATH)
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

/**
 * A safe gno.land realm/package path — the only shape we'll put in a qeval expr. The path also
 * becomes a same-origin link, so no segment may be empty, "." or "..": a browser would resolve
 * those to another page.
 */
const REALM_PATH_RE = /^gno\.land\/[rp](?:\/(?!\.{1,2}(?:\/|$))[a-zA-Z0-9_.-]+)+$/

export function isSafeRealmPath(p: string): boolean {
    return REALM_PATH_RE.test(p) && p.length <= 200
}

/** FlagApp measured on gnoland-1 (09-30): 7.03M to 7.53M gas. The limit is twice that. */
export const APP_FLAG_GAS_WANTED = 15_000_000

/** memba_appstore_v3 `FlagHideThreshold`: reports from this many accounts hide a listing from the public lists until a curator clears them. */
export const FLAG_HIDE_THRESHOLD = 5

/** Bytes a report stores, never returned: 1,095 to 1,098 measured for 25- to 33-byte paths, since the report's key holds the path. */
export function appFlagStorageBytes(pkgPath: string): number {
    return 1_070 + new TextEncoder().encode(pkgPath).length
}

/**
 * FlagApp(pkgPath) — the community report action, with its deposit capped. One report per
 * account per listing; at `FLAG_HIDE_THRESHOLD` the listing drops from the public lists until a
 * curator clears the reports. pkgPath is validated before it becomes a broadcast argument.
 */
export function buildFlagAppMsg(caller: string, pkgPath: string): AminoMsg {
    if (!isSafeRealmPath(pkgPath)) throw new Error("invalid app path")
    return {
        type: "vm/MsgCall",
        value: {
            caller, send: "", pkg_path: APPSTORE_REALM_PATH, func: "FlagApp", args: [pkgPath],
            max_deposit: `${depositCapUgnot(appFlagStorageBytes(pkgPath))}ugnot`,
        },
    }
}

/** What the realm refuses after charging the fee, read from a verified node: a listing that is gone or closed, or a second report from this account. */
export async function assertAppReportApplies(caller: string, pkgPath: string): Promise<void> {
    if (!ADDRESS_RE.test(caller)) throw new Error("Connect your wallet first.")
    const listing = await fetchAppStrict(pkgPath)
    if (!listing || (listing.status !== "live" && listing.status !== "pending")) throw new Error("This listing can no longer be reported. Refresh the page.")
    const raw = (await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, `HasGovernanceFlag(${JSON.stringify(pkgPath)}, ${JSON.stringify(caller)})`, true))?.trim()
    if (raw === "(true bool)") throw new Error("You have already reported this listing.")
    if (raw !== "(false bool)") throw new Error("The App Store registry could not be read. Nothing was sent.")
}

/** A check made before the wallet stopped the call: nothing was sent, and the message says why. */
export class NothingSentError extends Error {}

/** What the RPC layer or the browser says when the network cannot be reached: not quoted to the user. */
const TRANSPORT = /^(RPC error|HTTP \d|Malformed abci_query)|Failed to fetch|NetworkError|Load failed|timed? ?out/i

async function beforeWallet<T>(step: () => Promise<T>): Promise<T> {
    try { return await step() }
    catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause)
        throw new NothingSentError(cause instanceof TypeError || TRANSPORT.test(msg) ? "Memba could not reach the network. Nothing was sent; try again in a moment." : msg)
    }
}

/**
 * Send one App Store call from a classic page at its measured gas limit and the fee read from the
 * chain now, once. `check` (what the realm would refuse after charging the fee) runs before the
 * confirmation opens and again after it closes, then the fee; a stop there is a `NothingSentError`.
 */
export async function sendAppStoreCall(msg: AminoMsg, memo: string, gasWanted: number, check: () => Promise<void>): Promise<string> {
    await beforeWallet(check)
    const gasFee = await beforeWallet(() => freshFeeForGasWanted(gasWanted).catch(() => {
        throw new Error("The network fee could not be read. Nothing was sent; try again in a moment.")
    }))
    const { hash } = await doContractBroadcast([msg], memo, {
        gasWanted, gasFee,
        beforeSign: () => beforeWallet(async () => {
            await check()
            await assertFeeStillCovers(gasFee, () => freshFeeForGasWanted(gasWanted), "Try again to see the new fee.")
        }),
    })
    return hash
}

/** Report from the classic page. */
export function submitAppReport(caller: string, pkgPath: string): Promise<string> {
    return sendAppStoreCall(buildFlagAppMsg(caller, pkgPath), "Report app", APP_FLAG_GAS_WANTED, () => assertAppReportApplies(caller, pkgPath))
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
        // Missing, never zero, when the realm does not give it (v2).
        resubmitCount: typeof r.resubmitCount === "number" ? r.resubmitCount : undefined,
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

/** Strict read for discovery: an unavailable or malformed registry must not look empty. */
export async function fetchLiveAppsPage(offset: number, limit: number): Promise<{ apps: AppListing[]; windowSize: number }> {
    const raw = await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, `ListLiveJSON(${offset | 0}, ${limit | 0})`)
    if (!raw) throw new Error("App Store registry is unavailable")
    const parsed = parseQevalJSON(raw)
    if (!Array.isArray(parsed)) throw new Error("App Store registry returned an invalid page")
    return { apps: parsed.map(coerce).filter((x): x is AppListing => x !== null), windowSize: parsed.length }
}

/** Bounded full-catalog read for a small registry. `complete=false` forbids claiming full search. */
export async function fetchLiveCatalogue(pageSize = 50, maxPages = 10): Promise<{ apps: AppListing[]; complete: boolean }> {
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)))
    const safeMaxPages = Math.max(1, Math.min(20, Math.floor(maxPages)))
    const apps: AppListing[] = []
    for (let page = 0; page < safeMaxPages; page++) {
        const batch = await fetchLiveAppsPage(page * safePageSize, safePageSize)
        apps.push(...batch.apps)
        if (batch.windowSize < safePageSize) return { apps, complete: true }
    }
    return { apps, complete: false }
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

/** Native detail read on a verified node: only the realm's explicit null means absent. RPC failures stay errors. */
export async function fetchAppStrict(pkgPath: string): Promise<AppListing | null> {
    if (!isSafeRealmPath(pkgPath)) throw new Error("Invalid app path")
    const raw = await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, `GetListingJSON(${JSON.stringify(pkgPath)})`, true)
    if (!raw) throw new Error("App Store registry is unavailable")
    if (raw.trim() === '("null" string)') return null
    const listing = coerce(parseQevalJSON(raw))
    if (!listing || listing.pkgPath !== pkgPath) throw new Error("App Store registry returned an invalid listing")
    return listing
}

export interface CuratorQueue {
    /** Pending listings the registry lists, oldest first. */
    pending: AppListing[]
    /** Pending listings that reports hide from the registry's lists; null when the queue was not read to its end. */
    hidden: number | null
    curators: string[]
}

async function evalStrict(expr: string): Promise<unknown> {
    const raw = await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, expr, true)
    if (!raw) throw new Error("App Store registry is unavailable")
    return parseQevalJSON(raw)
}

/** The realm's MaxPageLimit: a longer window comes back cut to this. */
const MAX_PAGE_LIMIT = 100

/** The registry's counters, fee and pause switch, read on a verified node. */
export interface RegistryState { pending: number; registrationFee: number; paused: boolean }

export async function fetchRegistryState(): Promise<RegistryState> {
    const stats = await evalStrict("GetStatsJSON()")
    const r = stats && typeof stats === "object" ? stats as Record<string, unknown> : {}
    if (typeof r.pending !== "number" || !Number.isSafeInteger(r.registrationFee) || typeof r.paused !== "boolean") throw new Error("App Store registry returned invalid state")
    return { pending: r.pending, registrationFee: r.registrationFee as number, paused: r.paused }
}

const pendingTotal = async () => (await fetchRegistryState()).pending

/**
 * The curator queue, read on a verified node; a failed read throws, so an outage never looks like
 * an empty queue. `ListByStatusJSON("pending")` leaves out listings hidden by reports and no read
 * lists them, but `GetStatsJSON` counts them, so their number is known once the queue is read to its end.
 */
export async function fetchCuratorQueue(pageSize = MAX_PAGE_LIMIT, maxPages = 5): Promise<CuratorQueue> {
    const size = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(pageSize)))
    const [before, curators] = await Promise.all([pendingTotal(), evalStrict("GetCuratorsJSON()")])
    if (!Array.isArray(curators) || !curators.every((c) => typeof c === "string" && ADDRESS_RE.test(c))) {
        throw new Error("App Store registry returned invalid curator data")
    }
    const pending: AppListing[] = []
    let listed = 0
    for (let page = 0; page < maxPages; page++) {
        const window = await evalStrict(`ListByStatusJSON("pending", ${page * size}, ${size})`)
        if (!Array.isArray(window)) throw new Error("App Store registry returned an invalid page")
        listed += window.length
        pending.push(...window.map(coerce).filter((x): x is AppListing => x !== null))
        if (window.length < size) {
            // The pages and the counter may be read at different heights: a count is stated only when the counter held still.
            const after = await pendingTotal()
            return { pending, hidden: after === before ? Math.max(0, before - listed) : null, curators }
        }
    }
    return { pending, hidden: null, curators }
}

/** Realm-level catalog stats. v3's GetStatsJSON is a superset (adds per-status
 * counts); only the fields both generations expose are kept. */
export interface AppStoreStats {
    total: number
    live: number
    registrationFee: number
    paused: boolean
}

/** Fetch catalog stats (`GetStatsJSON` — exposed by v2 AND v3, so this survives the
 * env-driven repoint). Returns null on any error so the masthead can fall back to
 * counting the fetched window instead of showing nothing. */
export async function fetchAppStoreStats(): Promise<AppStoreStats | null> {
    const raw = await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, "GetStatsJSON()")
    if (!raw) return null
    const parsed = parseQevalJSON(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const r = parsed as Record<string, unknown>
    if (typeof r.total !== "number" || typeof r.live !== "number") return null
    return {
        total: r.total,
        live: r.live,
        registrationFee: Number(r.registrationFee) || 0,
        paused: r.paused === true,
    }
}
