/**
 * Template Sanitizer — centralized input validation for all Gno realm template generators.
 *
 * Every template generator (dao, board, channel, candidature, escrow, agent, nft)
 * MUST delegate user-input validation to this module. This prevents injection
 * vulnerabilities from inconsistent per-template sanitization.
 *
 * @module lib/templates/sanitizer
 */

import { BECH32_PREFIX } from "../config"

// ── Address Validation ──────────────────────────────────────

/** Strict bech32 address regex — prefix + 38 lowercase alphanumeric chars. */
const BECH32_REGEX = new RegExp(`^${BECH32_PREFIX}[a-z0-9]{38}$`)

/**
 * Validate a Gno address is strict bech32 format.
 * Returns true for addresses like g1abc...xyz (40 chars total).
 */
export function isValidGnoAddress(addr: string): boolean {
    return typeof addr === "string" && BECH32_REGEX.test(addr)
}

// ── Identifier Validation ───────────────────────────────────

/** Alphanumeric + underscore only — safe for Gno identifiers. */
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/

/**
 * Validate a role, category, or channel name.
 * Must be lowercase alphanumeric + underscore, starting with a letter.
 * Max 30 chars.
 */
export function isValidIdentifier(s: string): boolean {
    return typeof s === "string" && SAFE_IDENTIFIER.test(s) && s.length <= 30
}

/** Channel name validator — allows hyphens in addition to identifier chars. */
const SAFE_CHANNEL = /^[a-z][a-z0-9_-]*$/

/**
 * Validate a channel name for board/channel templates.
 * Allows lowercase alphanumeric + underscore + hyphens, starting with a letter.
 * Max 30 chars.
 */
export function isValidChannelName(s: string): boolean {
    return typeof s === "string" && SAFE_CHANNEL.test(s) && s.length <= 30
}

// ── String Sanitization ─────────────────────────────────────

/**
 * Sanitize a user-provided string for safe interpolation into Gno source code.
 *
 * Strategy:
 * 1. Strip control characters (NUL, newlines, tabs, etc.)
 * 2. Enforce maximum length
 * 3. Trim whitespace
 *
 * For interpolation into Go string literals, use `escapeGnoString()` additionally.
 */
export function sanitizeString(s: string, maxLen = 256): string {
    if (typeof s !== "string") return ""
    // Strip control characters except space
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, maxLen)
}

/**
 * Escape a string for use inside a Go/Gno double-quoted string literal.
 *
 * Handles: backslash, double-quote, backtick, dollar sign (template literal escape).
 * Does NOT add surrounding quotes — caller is responsible for that.
 */
export function escapeGnoString(s: string): string {
    return s
        .replace(/\\/g, "\\\\")    // backslash first
        .replace(/"/g, '\\"')      // double quotes
        .replace(/`/g, "\\`")      // backticks (Go raw string escape)
        .replace(/\$/g, "\\$")     // dollar sign (TS template literal defense)
}

/**
 * Sanitize and escape for Gno — combines sanitizeString + escapeGnoString.
 * Use this for DAO names, descriptions, and other user-facing text.
 */
export function sanitizeForGno(s: string, maxLen = 256): string {
    return escapeGnoString(sanitizeString(s, maxLen))
}

// ── Realm Path Validation ───────────────────────────────────

/**
 * Validate a Gno realm path.
 * Must follow pattern: gno.land/r/namespace/realmname
 * All segments must be lowercase alphanumeric + underscore.
 * Returns error string or null if valid.
 */
export function validateRealmPath(path: string): string | null {
    if (!path.startsWith("gno.land/r/")) return "Must start with gno.land/r/"
    const parts = path.replace("gno.land/r/", "").split("/")
    if (parts.length < 2) return "Must include namespace and realm name (e.g., gno.land/r/myname/myrealm)"
    if (parts.some((p) => !p || p.length === 0)) return "Path segments cannot be empty"
    if (parts.some((p) => !/^[a-z0-9_]+$/.test(p))) return "Path segments must be lowercase alphanumeric with underscores only"
    const name = parts[parts.length - 1]
    if (name.length < 3) return "Realm name must be at least 3 characters"
    if (name.length > 30) return "Realm name must be at most 30 characters"
    return null // valid
}

/**
 * Extract the package name from a realm path.
 * e.g., "gno.land/r/samcrew/memba_dao" → "memba_dao"
 */
export function extractPkgName(realmPath: string, fallback = "myrealm"): string {
    return realmPath.split("/").pop() || fallback
}

// ── Numeric Validation ──────────────────────────────────────

/**
 * Clamp an integer to a safe range.
 * Used for threshold, quorum, fee percentages, gas amounts, etc.
 */
export function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.floor(value)))
}

/**
 * Validate a percentage value (0-100).
 */
export function isValidPercentage(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 100
}
