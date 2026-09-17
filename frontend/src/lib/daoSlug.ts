/**
 * DAO slug helpers — URL-safe encoding for realm paths + localStorage persistence.
 *
 * Realm path: "gno.land/r/gov/dao" ⇄ Slug: "gno.land~r~gov~dao"
 */

import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, NETWORKS } from "./config"

const LS_KEY = "memba_saved_daos"
const LS_ORG_KEY_PREFIX = "memba_saved_daos_org_"

/** Allowed characters in a decoded realm path — prevents traversal and injection. */
const VALID_REALM_PATH = /^gno\.land\/r\/[a-zA-Z0-9_/]+$/

/** Default featured DAO — the only governance DAO on test11. */
export const FEATURED_DAO = {
    realmPath: "gno.land/r/gov/dao",
    name: "GovDAO",
}

export interface SavedDAO {
    realmPath: string
    name: string
    addedAt: number
    /** Organization ID this DAO belongs to, or undefined for personal. */
    orgId?: string
    /** Network key this DAO was saved on (e.g. "test13"). Undefined for legacy
     *  entries saved before network-scoping (MH2); those are shown only when their
     *  realm actually resolves on the active network — see useYourWorlds — so DAOs
     *  saved on a different testnet (e.g. retired test11) drop off instead of
     *  rendering as dead cards. */
    network?: string
    /** Chain id the DAO was saved on. Lists show only entries for the active
     *  chain; the same realm path on two chains is two different DAOs. Entries
     *  saved before this field existed get the chain of their network tag on
     *  first read; untagged entries stay untagged. */
    chainId?: string
}

// ── Slug encoding ─────────────────────────────────────────

/**
 * Encode a realm path for use in URLs.
 * Phase 2: returns the path as-is (real forward slashes) for clean URLs.
 * Old ~ format is still decoded for backwards compatibility.
 */
export function encodeSlug(realmPath: string): string {
    return realmPath
}

/**
 * Decode a URL slug back to a realm path.
 * Supports both legacy "~" format and new "/" format.
 * Validates the result to prevent path traversal and injection.
 * Returns empty string if invalid.
 */
export function decodeSlug(slug: string): string {
    // Support legacy ~ encoding
    const decoded = slug.includes("~") ? slug.replace(/~/g, "/") : slug
    // Block traversal, control chars, and non-gno.land paths
    if (decoded.includes("..") || !VALID_REALM_PATH.test(decoded)) {
        return ""
    }
    return decoded
}

/** Known DAO sub-route keywords — used to parse splat paths. */
const DAO_SUB_ROUTES = ["proposal", "proposals", "members", "settings", "propose", "treasury", "channels", "plugin", "create"]

/**
 * Parse a DAO splat path to extract the realm path and sub-route.
 *
 * Examples:
 *   "gno.land/r/gov/dao" → { realmPath: "gno.land/r/gov/dao", subRoute: "" }
 *   "gno.land/r/gov/dao/proposal/5" → { realmPath: "gno.land/r/gov/dao", subRoute: "proposal/5" }
 *   "gno.land/r/gov/dao/members" → { realmPath: "gno.land/r/gov/dao", subRoute: "members" }
 *   "gno.land/r/gov/dao/treasury/propose" → { realmPath: "gno.land/r/gov/dao", subRoute: "treasury/propose" }
 *   "gno.land~r~gov~dao" → { realmPath: "gno.land/r/gov/dao", subRoute: "" } (legacy)
 */
export function parseDaoSplat(splat: string): { realmPath: string; subRoute: string } {
    if (!splat) return { realmPath: "", subRoute: "" }

    // Handle legacy ~ encoded slugs
    if (splat.includes("~")) {
        const realmPath = decodeSlug(splat.split("/")[0])
        const rest = splat.includes("/") ? splat.slice(splat.indexOf("/") + 1) : ""
        return { realmPath, subRoute: rest }
    }

    // Split by / and find where the sub-route starts
    const segments = splat.split("/")
    for (let i = 0; i < segments.length; i++) {
        if (DAO_SUB_ROUTES.includes(segments[i])) {
            const realmPath = segments.slice(0, i).join("/")
            const subRoute = segments.slice(i).join("/")
            if (VALID_REALM_PATH.test(realmPath)) {
                return { realmPath, subRoute }
            }
        }
    }

    // No sub-route found — entire splat is the realm path
    const full = segments.join("/")
    if (VALID_REALM_PATH.test(full)) {
        return { realmPath: full, subRoute: "" }
    }

    return { realmPath: "", subRoute: "" }
}

/**
 * Validate a raw realm path input from the user.
 * Returns an error message or null if valid.
 */
export function validateRealmPath(path: string): string | null {
    if (!path) return "Realm path is required"
    if (path.length > 100) return "Realm path is too long (max 100 characters)"
    if (!path.startsWith("gno.land/r/")) return "Realm path must start with gno.land/r/"
    if (path.includes("..")) return "Invalid realm path (path traversal blocked)"
    if (!VALID_REALM_PATH.test(path)) return "Realm path contains invalid characters"
    return null
}

// ── LocalStorage persistence ──────────────────────────────

function isSavedDAO(d: unknown): d is SavedDAO {
    if (typeof d !== "object" || d === null) return false
    const e = d as Record<string, unknown>
    return typeof e.realmPath === "string" && e.realmPath.length > 0 &&
        typeof e.name === "string" && e.name.length > 0 &&
        typeof e.addedAt === "number"
}

/**
 * Read a saved-DAO list. Entries without a chain id but tagged with a known
 * network get that network's chain id (written back once). Tags are never
 * rewritten; untagged entries and entries tagged for a network no longer in
 * the config are left as they are.
 */
function readList(key: string): SavedDAO[] {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        const entries = parsed.filter(isSavedDAO)
        let migrated = false
        for (const d of entries) {
            if (d.chainId || !d.network) continue
            const chainId = Object.hasOwn(NETWORKS, d.network) ? NETWORKS[d.network].chainId : undefined
            if (chainId) {
                d.chainId = chainId
                migrated = true
            }
        }
        if (migrated) writeList(key, entries)
        return entries
    } catch {
        return []
    }
}

function writeList(key: string, daos: SavedDAO[]): void {
    try {
        localStorage.setItem(key, JSON.stringify(daos))
    } catch { /* quota exceeded */ }
}

const onActiveChain = (d: SavedDAO) => d.chainId === GNO_CHAIN_ID
/** Saved before network tagging: shown on every network, as before (consumers
 *  drop the ones whose realm does not resolve on the active chain). */
const isUntagged = (d: SavedDAO) => !d.chainId && !d.network
const visibleHere = (d: SavedDAO) => onActiveChain(d) || isUntagged(d)

/** Every saved DAO on every chain (validated, migrated). */
export function getAllSavedDAOs(): SavedDAO[] {
    return readList(LS_KEY)
}

/** Saved DAOs for the active chain. */
export function getSavedDAOs(): SavedDAO[] {
    return getAllSavedDAOs().filter(visibleHere)
}

/** Add or rename a DAO on the active chain. Stamps the network and chain the
 *  app was loaded with (never the storage echo another tab may have written). */
function upsert(key: string, realmPath: string, name: string | undefined, orgId?: string): void {
    if (!VALID_REALM_PATH.test(realmPath)) return
    const daos = readList(key)
    const existing = daos.find((d) => d.realmPath === realmPath && visibleHere(d))
    if (existing) {
        if (name) existing.name = name
        // Tag an untagged entry on re-pin; never rewrite an existing tag.
        if (isUntagged(existing)) {
            existing.network = ACTIVE_NETWORK_KEY
            existing.chainId = GNO_CHAIN_ID
        }
    } else {
        daos.push({
            realmPath,
            name: name || realmPath.split("/").pop() || "DAO",
            addedAt: Date.now(),
            ...(orgId ? { orgId } : {}),
            network: ACTIVE_NETWORK_KEY,
            chainId: GNO_CHAIN_ID,
        })
    }
    writeList(key, daos)
}

/** Add a DAO to saved list (deduplicated by realm path per chain). */
export function addSavedDAO(realmPath: string, name?: string): void {
    upsert(LS_KEY, realmPath, name)
}

/** Remove a DAO from the active chain's saved list. */
export function removeSavedDAO(realmPath: string): void {
    writeList(LS_KEY, getAllSavedDAOs().filter((d) => !(d.realmPath === realmPath && visibleHere(d))))
}

// ── Org-scoped DAO persistence (v2.22.0) ─────────────────

function orgKey(orgId: string): string {
    return `${LS_ORG_KEY_PREFIX}${orgId}`
}

/**
 * Get saved DAOs for a specific org on the active chain.
 * Returns org-scoped DAOs if orgId is provided, personal DAOs if null.
 */
export function getSavedDAOsForOrg(orgId: string | null): SavedDAO[] {
    if (!orgId) return getSavedDAOs()
    return readList(orgKey(orgId)).filter(visibleHere)
}

/** Add a DAO to an org's saved list. */
export function addSavedDAOForOrg(orgId: string | null, realmPath: string, name?: string): void {
    if (!orgId) { addSavedDAO(realmPath, name); return }
    upsert(orgKey(orgId), realmPath, name, orgId)
}

/** Remove a DAO from an org's saved list on the active chain. */
export function removeSavedDAOForOrg(orgId: string | null, realmPath: string): void {
    if (!orgId) { removeSavedDAO(realmPath); return }
    writeList(orgKey(orgId), readList(orgKey(orgId)).filter((d) => !(d.realmPath === realmPath && visibleHere(d))))
}
