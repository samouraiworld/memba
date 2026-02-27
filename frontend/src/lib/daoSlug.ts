/**
 * DAO slug helpers — URL-safe encoding for realm paths + localStorage persistence.
 *
 * Realm path: "gno.land/r/gov/dao" ⇄ Slug: "gno.land~r~gov~dao"
 */

const LS_KEY = "memba_saved_daos"

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
}

// ── Slug encoding ─────────────────────────────────────────

/** Encode a realm path to a URL-safe slug: "/" → "~" */
export function encodeSlug(realmPath: string): string {
    return realmPath.replace(/\//g, "~")
}

/**
 * Decode a URL slug back to a realm path: "~" → "/"
 * Validates the result to prevent path traversal and injection.
 * Returns empty string if invalid.
 */
export function decodeSlug(slug: string): string {
    const decoded = slug.replace(/~/g, "/")
    // Block traversal, control chars, and non-gno.land paths
    if (decoded.includes("..") || !VALID_REALM_PATH.test(decoded)) {
        return ""
    }
    return decoded
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
