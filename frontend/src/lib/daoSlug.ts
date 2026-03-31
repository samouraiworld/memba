/**
 * DAO slug helpers — URL-safe encoding for realm paths + localStorage persistence.
 *
 * Realm path: "gno.land/r/gov/dao" ⇄ Slug: "gno.land~r~gov~dao"
 */

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
const DAO_SUB_ROUTES = ["proposal", "members", "propose", "treasury", "channels", "plugin", "create"]

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

/** Get all saved DAOs from localStorage. Validates each entry's schema. */
export function getSavedDAOs(): SavedDAO[] {
    try {
        const raw = localStorage.getItem(LS_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        // Schema validation: each entry must have string realmPath and name
        return parsed.filter(
            (d): d is SavedDAO =>
                typeof d === "object" && d !== null &&
                typeof d.realmPath === "string" && d.realmPath.length > 0 &&
                typeof d.name === "string" && d.name.length > 0 &&
                typeof d.addedAt === "number",
        )
    } catch {
        return []
    }
}

/** Add a DAO to saved list (deduplicates by realmPath). */
export function addSavedDAO(realmPath: string, name?: string): void {
    if (!VALID_REALM_PATH.test(realmPath)) return
    const daos = getSavedDAOs()
    const existing = daos.find((d) => d.realmPath === realmPath)
    if (existing) {
        // Update name if provided
        if (name) existing.name = name
    } else {
        daos.push({ realmPath, name: name || realmPath.split("/").pop() || "DAO", addedAt: Date.now() })
    }
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(daos))
    } catch { /* quota exceeded */ }
}

/** Remove a DAO from saved list. */
export function removeSavedDAO(realmPath: string): void {
    const daos = getSavedDAOs().filter((d) => d.realmPath !== realmPath)
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(daos))
    } catch { /* ignore */ }
}

// ── Org-scoped DAO persistence (v2.22.0) ─────────────────

function orgKey(orgId: string): string {
    return `${LS_ORG_KEY_PREFIX}${orgId}`
}

/**
 * Get saved DAOs for a specific org.
 * Returns org-scoped DAOs if orgId is provided, personal DAOs if null.
 */
export function getSavedDAOsForOrg(orgId: string | null): SavedDAO[] {
    if (!orgId) return getSavedDAOs()
    try {
        const raw = localStorage.getItem(orgKey(orgId))
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter(
            (d): d is SavedDAO =>
                typeof d === "object" && d !== null &&
                typeof d.realmPath === "string" && d.realmPath.length > 0 &&
                typeof d.name === "string" && d.name.length > 0 &&
                typeof d.addedAt === "number",
        )
    } catch {
        return []
    }
}

/** Add a DAO to an org's saved list. */
export function addSavedDAOForOrg(orgId: string | null, realmPath: string, name?: string): void {
    if (!orgId) { addSavedDAO(realmPath, name); return }
    if (!VALID_REALM_PATH.test(realmPath)) return
    const daos = getSavedDAOsForOrg(orgId)
    const existing = daos.find((d) => d.realmPath === realmPath)
    if (existing) {
        if (name) existing.name = name
    } else {
        daos.push({ realmPath, name: name || realmPath.split("/").pop() || "DAO", addedAt: Date.now(), orgId })
    }
    try {
        localStorage.setItem(orgKey(orgId), JSON.stringify(daos))
    } catch { /* quota exceeded */ }
}

/** Remove a DAO from an org's saved list. */
export function removeSavedDAOForOrg(orgId: string | null, realmPath: string): void {
    if (!orgId) { removeSavedDAO(realmPath); return }
    const daos = getSavedDAOsForOrg(orgId).filter((d) => d.realmPath !== realmPath)
    try {
        localStorage.setItem(orgKey(orgId), JSON.stringify(daos))
    } catch { /* ignore */ }
}
