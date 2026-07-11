/**
 * appStoreSubmit — write-side client for the memba_appstore_v3 submission money path (B3).
 *
 * Builds the `RegisterApp` (exact-fee coin attach) and `EditListing` (free resubmit) wallet
 * messages, reads the live registration fee from the realm, and mirrors the realm's field
 * validation client-side so a rejected transaction is caught BEFORE the wallet prompt.
 *
 * SECURITY:
 * - Field limits and the `appURL` scheme allowlist mirror `memba_appstore_v3` exactly
 *   (`validateListingFields` / `validateAppURL` in appstore.gno) — the realm stays the
 *   authority; this is UX, not enforcement.
 * - The fee is read from `GetRegistrationFee()` at submit time, never hardcoded: the realm
 *   demands an EXACT coin match, so a stale client constant would brick every submission
 *   the moment the DAO changes the fee.
 * - Builders throw on any invalid field — a tx the realm will panic on is never broadcast.
 *
 * @module lib/appStoreSubmit
 */

import { queryEval } from "./dao/shared"
import type { AminoMsg } from "./grc20"
import { GNO_RPC_URL } from "./config"
import { APPSTORE_REALM_PATH, isSafeRealmPath } from "./appStore"

// Field limits — MUST stay equal to the memba_appstore_v3 realm constants.
export const MAX_NAME_LEN = 80
export const MAX_TAGLINE_LEN = 140
export const MAX_DESCR_LEN = 2000
export const MAX_CATEGORY_LEN = 40
export const MAX_URL_LEN = 400
export const MAX_CID_LEN = 100
export const MAX_SCREENSHOTS = 6

/** The 8 wire fields of RegisterApp/EditListing, in realm signature order. */
export interface AppSubmission {
    pkgPath: string
    name: string
    tagline: string
    descr: string
    category: string
    iconCID: string
    screenshotsCSV: string
    appURL: string
}

/**
 * Client mirror of the realm's appURL scheme allowlist: empty, http://, https://, or a
 * leading-slash in-app path that is NOT protocol-relative (`//host`, `/\host`). Returns a
 * user-facing error message, or null when the URL is acceptable.
 */
export function validateAppURL(u: string): string | null {
    if (u === "") return null
    if (u.startsWith("http://") || u.startsWith("https://")) return null
    if (u[0] === "/") {
        if (u.length > 1 && (u[1] === "/" || u[1] === "\\")) {
            return "A leading-slash path must stay in-app — protocol-relative //host is not allowed"
        }
        return null
    }
    return "The app URL must start with https://, http://, or / (an in-app path)"
}

/**
 * Validate a submission against the realm's rules. Returns a map of per-field error messages —
 * empty when the submission would pass the realm's `validateListingFields` + `validatePkgPath`.
 */
export function validateSubmission(s: AppSubmission): Partial<Record<keyof AppSubmission, string>> {
    const errors: Partial<Record<keyof AppSubmission, string>> = {}
    // Stricter than the realm on charset (isSafeRealmPath is the app-wide qeval-injection
    // guard); equal on prefix + length. The pkgPath is the listing's permanent unique key.
    if (!isSafeRealmPath(s.pkgPath)) {
        errors.pkgPath = "Must be a gno.land/r/… or gno.land/p/… package path (letters, digits, _ . / -)"
    }
    if (s.name.length === 0 || s.name.length > MAX_NAME_LEN) {
        errors.name = `Name is required (max ${MAX_NAME_LEN} chars)`
    }
    if (s.tagline.length > MAX_TAGLINE_LEN) {
        errors.tagline = `Tagline is too long (max ${MAX_TAGLINE_LEN} chars)`
    }
    if (s.descr.length > MAX_DESCR_LEN) {
        errors.descr = `Description is too long (max ${MAX_DESCR_LEN} chars)`
    }
    if (s.category.length > MAX_CATEGORY_LEN) {
        errors.category = `Category is too long (max ${MAX_CATEGORY_LEN} chars)`
    }
    if (s.iconCID.length > MAX_CID_LEN) {
        errors.iconCID = `Icon CID is too long (max ${MAX_CID_LEN} chars)`
    }
    if (s.appURL.length > MAX_URL_LEN) {
        errors.appURL = `URL is too long (max ${MAX_URL_LEN} chars)`
    } else {
        const urlErr = validateAppURL(s.appURL)
        if (urlErr) errors.appURL = urlErr
    }
    // Mirror parseScreenshots: split on commas, blanks dropped, ≤6 CIDs of ≤100 chars each.
    if (s.screenshotsCSV !== "") {
        const parts = s.screenshotsCSV.split(",")
        if (parts.length > MAX_SCREENSHOTS) {
            errors.screenshotsCSV = `At most ${MAX_SCREENSHOTS} screenshot CIDs`
        } else if (parts.some((p) => p.trim().length > MAX_CID_LEN)) {
            errors.screenshotsCSV = `Each screenshot CID must be at most ${MAX_CID_LEN} chars`
        }
    }
    return errors
}

function assertValid(s: AppSubmission): void {
    const errors = validateSubmission(s)
    const bad = Object.keys(errors)
    if (bad.length > 0) {
        throw new Error(`invalid submission field(s): ${bad.join(", ")}`)
    }
}

/** The 8 args in the realm's RegisterApp/EditListing signature order. */
function wireArgs(s: AppSubmission): string[] {
    return [s.pkgPath, s.name, s.tagline, s.descr, s.category, s.iconCID, s.screenshotsCSV, s.appURL]
}

/**
 * RegisterApp(pkgPath, …) — THE money path. Attaches exactly `feeUgnot` (from
 * `fetchRegistrationFee`; the realm rejects any other amount and a revert refunds the coins).
 * A zero fee attaches no coins — the realm's exact-coin check expects 0 in that case.
 */
export function buildRegisterAppMsg(caller: string, feeUgnot: number, s: AppSubmission): AminoMsg {
    if (!Number.isSafeInteger(feeUgnot) || feeUgnot < 0) {
        throw new Error("invalid registration fee — refresh and try again")
    }
    assertValid(s)
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: feeUgnot > 0 ? `${feeUgnot}ugnot` : "",
            pkg_path: APPSTORE_REALM_PATH,
            func: "RegisterApp",
            args: wireArgs(s),
        },
    }
}

/**
 * EditListing(pkgPath, …) — publisher-only, free (no coin attach). The realm resets the
 * listing to `pending` for re-review; a rejected listing's one resubmit credit covers it.
 */
export function buildEditListingMsg(caller: string, s: AppSubmission): AminoMsg {
    assertValid(s)
    return {
        type: "vm/MsgCall",
        value: { caller, send: "", pkg_path: APPSTORE_REALM_PATH, func: "EditListing", args: wireArgs(s) },
    }
}

/**
 * DelistApp(pkgPath) — publisher (or curator), free, idempotent on the realm.
 * ⚠️ ONE-WAY for the publisher: only a curator's `RestoreApp` can bring a
 * delisted app back, and the package path stays taken (`RegisterApp`'s
 * duplicate check is status-blind). The UI must warn before signing.
 */
export function buildDelistAppMsg(caller: string, pkgPath: string): AminoMsg {
    if (!pkgPath.trim()) throw new Error("missing package path")
    return {
        type: "vm/MsgCall",
        value: { caller, send: "", pkg_path: APPSTORE_REALM_PATH, func: "DelistApp", args: [pkgPath] },
    }
}

/**
 * Read the live registration fee (ugnot) from the realm. Returns null on any failure —
 * callers MUST block submission on null rather than guess (exact-coin match required).
 */
export async function fetchRegistrationFee(): Promise<number | null> {
    const raw = await queryEval(GNO_RPC_URL, APPSTORE_REALM_PATH, "GetRegistrationFee()")
    if (!raw) return null
    const m = raw.match(/\((\d+)\s+int64\)/)
    if (!m) return null
    const fee = Number(m[1])
    return Number.isSafeInteger(fee) ? fee : null
}

/** Render a ugnot amount as a human GNOT figure ("1", "1.5", "0.25"). */
export function formatGnot(ugnot: number): string {
    return String(ugnot / 1_000_000)
}
