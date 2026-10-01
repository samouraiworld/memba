/**
 * appStoreSubmit — write-side client for the memba_appstore_v3 submission money path (B3).
 *
 * Builds the `RegisterApp` (exact-fee coin attach), `EditListing` (resubmit, no listing fee) and `DelistApp`
 * wallet messages with their measured gas limits and capped deposits, reads the live registration
 * fee from the realm, and mirrors the realm's checks client-side (field bytes, the fee, the pause
 * switch, the listing's owner and state) so a transaction the realm would refuse after charging
 * the network fee is caught BEFORE the wallet prompt.
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
import { depositCapUgnot } from "./dao/v2Budget"
import type { AminoMsg } from "./grc20"
import { GNO_RPC_URL } from "./config"
import { APPSTORE_REALM_PATH, isSafeRealmPath, fetchApp, fetchAppStrict, fetchRegistryState, NothingSentError, sendAppStoreCall, type AppListing } from "./appStore"

// Field limits in UTF-8 bytes, as the realm counts them — MUST stay equal to the memba_appstore_v3 realm constants.
export const MAX_NAME_LEN = 80
export const MAX_TAGLINE_LEN = 140
export const MAX_DESCR_LEN = 2000
export const MAX_CATEGORY_LEN = 40
export const MAX_URL_LEN = 400
export const MAX_CID_LEN = 100
export const MAX_SCREENSHOTS = 6
// MAX_RESUBMITS mirrors the realm: a listing can be edited/resubmitted at most this many times.
export const MAX_RESUBMITS = 5

// Measured on gnoland-1 (09-30). RegisterApp: 13.69M gas for a minimal listing, 17.02M with six
// screenshots, 18.10M with every field at its limit. DelistApp: 9.48M to 10.34M. EditListing on
// its own cannot be measured on mainnet (no listing is pending); it did 4.0M to 4.2M of work after
// a registration in the same transaction, on top of the load cost DelistApp shows. Each limit is
// about twice the most measured, so that estimate included.
export const REGISTER_GAS_WANTED = 36_000_000
export const EDIT_GAS_WANTED = 30_000_000
export const DELIST_GAS_WANTED = 21_000_000
/** DelistApp stored 20 to 32 bytes. */
export const DELIST_STORAGE_BYTES = 64

export function utf8Bytes(text: string): number {
    return new TextEncoder().encode(text).length
}

function screenshotCount(csv: string): number {
    return csv === "" ? 0 : csv.split(",").filter((cid) => cid.trim() !== "").length
}

/** Every field but the package path, screenshot CIDs included, in bytes. */
function textBytes(s: AppSubmission): number {
    return utf8Bytes(s.name) + utf8Bytes(s.tagline) + utf8Bytes(s.descr) + utf8Bytes(s.category) + utf8Bytes(s.iconCID) + utf8Bytes(s.appURL) + utf8Bytes(s.screenshotsCSV)
}

/**
 * Bytes a new listing stores, never returned (the realm has no delete). Bounded on measurements:
 * 8,014 B for a minimal listing; each byte of the package path adds about 5 (it keys several
 * indexes), each byte of text 1, each screenshot about 115 beyond its CID's bytes.
 */
export function registerStorageBytes(s: AppSubmission): number {
    return 7_900 + 6 * utf8Bytes(s.pkgPath) + Math.ceil(1.1 * textBytes(s)) + 120 * screenshotCount(s.screenshotsCSV)
}

/** Bytes an edit adds: what its text and screenshots grow by (a shrink credited at its exact size), plus the 32 B an unchanged edit measured. */
export function editStorageBytes(was: AppSubmission, next: AppSubmission): number {
    const text = textBytes(next) - textBytes(was)
    const growth = (text > 0 ? Math.ceil(1.1 * text) : text) + 120 * (screenshotCount(next.screenshotsCSV) - screenshotCount(was.screenshotsCSV))
    return 64 + Math.max(0, growth)
}

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
 * Map a full listing (from GetListingJSON / fetchApp) to the editable submission form. A missing
 * descr / screenshots coerce to empty strings so the form renders blank rather than "undefined".
 */
export function listingToSubmission(l: AppListing): AppSubmission {
    return {
        pkgPath: l.pkgPath,
        name: l.name,
        tagline: l.tagline,
        descr: l.descr ?? "",
        category: l.category,
        iconCID: l.iconCID,
        screenshotsCSV: (l.screenshotCIDs ?? []).join(","),
        appURL: l.appURL,
    }
}

/**
 * Load a listing's FULL on-chain detail (GetListingJSON) and map it to the edit form. Returns null
 * when the listing can't be read. This is the single seam that stops EditListing from wiping fields:
 * the My-Submissions list window omits descr + screenshots, and EditListing overwrites EVERY field,
 * so an edit MUST be seeded from full detail — callers abort (never open the form) on null.
 */
export async function loadEditForm(pkgPath: string): Promise<AppSubmission | null> {
    const full = await fetchApp(pkgPath).catch(() => null)
    return full ? listingToSubmission(full) : null
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
    // The realm counts bytes: an accented letter takes two, most emoji four.
    if (s.name.length === 0 || utf8Bytes(s.name) > MAX_NAME_LEN) {
        errors.name = `Name is required (max ${MAX_NAME_LEN} bytes)`
    }
    if (utf8Bytes(s.tagline) > MAX_TAGLINE_LEN) {
        errors.tagline = `Tagline is too long (max ${MAX_TAGLINE_LEN} bytes)`
    }
    if (utf8Bytes(s.descr) > MAX_DESCR_LEN) {
        errors.descr = `Description is too long (max ${MAX_DESCR_LEN} bytes)`
    }
    if (utf8Bytes(s.category) > MAX_CATEGORY_LEN) {
        errors.category = `Category is too long (max ${MAX_CATEGORY_LEN} bytes)`
    }
    if (utf8Bytes(s.iconCID) > MAX_CID_LEN) {
        errors.iconCID = `Icon CID is too long (max ${MAX_CID_LEN} bytes)`
    }
    if (utf8Bytes(s.appURL) > MAX_URL_LEN) {
        errors.appURL = `URL is too long (max ${MAX_URL_LEN} bytes)`
    } else {
        const urlErr = validateAppURL(s.appURL)
        if (urlErr) errors.appURL = urlErr
    }
    // Mirror parseScreenshots: split on commas, blanks dropped, ≤6 CIDs of ≤100 chars each.
    if (s.screenshotsCSV !== "") {
        const parts = s.screenshotsCSV.split(",")
        if (parts.length > MAX_SCREENSHOTS) {
            errors.screenshotsCSV = `At most ${MAX_SCREENSHOTS} screenshot CIDs`
        } else if (parts.some((p) => utf8Bytes(p.trim()) > MAX_CID_LEN)) {
            errors.screenshotsCSV = `Each screenshot CID must be at most ${MAX_CID_LEN} bytes`
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
            max_deposit: `${depositCapUgnot(registerStorageBytes(s))}ugnot`,
        },
    }
}

/**
 * EditListing(pkgPath, …) — publisher-only, no listing fee (no coin attach). The realm resets
 * the listing to `pending` for re-review. `was` is the listing as loaded: the deposit is capped
 * on what the edit adds to it.
 */
export function buildEditListingMsg(caller: string, s: AppSubmission, was: AppSubmission): AminoMsg {
    assertValid(s)
    return {
        type: "vm/MsgCall",
        value: {
            caller, send: "", pkg_path: APPSTORE_REALM_PATH, func: "EditListing", args: wireArgs(s),
            max_deposit: `${depositCapUgnot(editStorageBytes(was, s))}ugnot`,
        },
    }
}

/**
 * DelistApp(pkgPath) — publisher (or curator), no listing fee, idempotent on the realm.
 * ⚠️ ONE-WAY for the publisher: only a curator's `RestoreApp` can bring a
 * delisted app back, and the package path stays taken (`RegisterApp`'s
 * duplicate check is status-blind). The UI must warn before signing.
 */
export function buildDelistAppMsg(caller: string, pkgPath: string): AminoMsg {
    if (!pkgPath.trim()) throw new Error("missing package path")
    return {
        type: "vm/MsgCall",
        value: {
            caller, send: "", pkg_path: APPSTORE_REALM_PATH, func: "DelistApp", args: [pkgPath],
            max_deposit: `${depositCapUgnot(DELIST_STORAGE_BYTES)}ugnot`,
        },
    }
}

// ── What the realm would refuse after charging the network fee, read on a verified node ──

function sameSubmission(a: AppSubmission, b: AppSubmission): boolean {
    return wireArgs(a).every((value, i) => value === wireArgs(b)[i])
}

/** A registration goes through only unpaused, at the fee the user was shown, on a free package path. */
export async function assertRegisterApplies(s: AppSubmission, feeUgnot: number): Promise<void> {
    assertValid(s)
    const state = await fetchRegistryState()
    if (state.paused) throw new Error("The App Store is paused: new listings are closed for now. Nothing was sent.")
    if (state.registrationFee !== feeUgnot) throw new Error(`The listing fee is now ${formatGnot(state.registrationFee)} GNOT. Review it again; nothing was sent.`)
    if (await fetchAppStrict(s.pkgPath)) throw new Error("An app is already listed for this package path.")
}

/**
 * An edit goes through only from the publisher, on a pending or rejected listing with edits left,
 * unchanged since it was loaded; with `editsUsed`, also not edited since (an unchanged edit still counts).
 */
export async function assertEditApplies(caller: string, s: AppSubmission, was: AppSubmission, editsUsed?: number): Promise<void> {
    assertValid(s)
    const listing = await fetchAppStrict(s.pkgPath)
    if (!listing || listing.publisher !== caller) throw new Error("Only the listing's publisher can edit it.")
    if (listing.status !== "pending" && listing.status !== "rejected") throw new Error("Only a pending or rejected listing can be edited.")
    if ((listing.resubmitCount ?? MAX_RESUBMITS) >= MAX_RESUBMITS) throw new Error(`This listing has used its ${MAX_RESUBMITS} edits.`)
    if (!sameSubmission(listingToSubmission(listing), was) || (editsUsed !== undefined && listing.resubmitCount !== editsUsed)) {
        throw new Error("This listing changed since it was loaded. Load it again, then edit it.")
    }
}

/** Delisting from Memba is the publisher's: a listing that is theirs and not already delisted. */
export async function assertDelistApplies(caller: string, pkgPath: string): Promise<void> {
    const listing = await fetchAppStrict(pkgPath)
    if (!listing || listing.publisher !== caller) throw new Error("Only the listing's publisher can delist it here.")
    if (listing.status === "delisted") throw new Error("This listing is already delisted.")
}

/** The wallet memo of each listing call, the same from the classic pages and Memba OS. */
export const LISTING_MEMO = { register: "Submit app", edit: "Resubmit app", delist: "Delist app" } as const

/** What stopped a classic submit, edit or delist: the checks made before the wallet say it themselves; a wallet dismissal says nothing. */
export function submitErrorText(e: unknown, action: string): string | null {
    const msg = e instanceof Error ? e.message : String(e)
    if (/denied|rejected by user|cancel/i.test(msg)) return null
    if (e instanceof NothingSentError || msg.startsWith("Adena returned an indeterminate transaction status.")) return msg
    return `The ${action} did not go through. A transaction that fails on chain still costs its network fee; nothing else is taken.`
}

export function submitRegisterApp(caller: string, s: AppSubmission, feeUgnot: number): Promise<string> {
    return sendAppStoreCall(buildRegisterAppMsg(caller, feeUgnot, s), LISTING_MEMO.register, REGISTER_GAS_WANTED, () => assertRegisterApplies(s, feeUgnot))
}

export function submitEditListing(caller: string, s: AppSubmission, was: AppSubmission): Promise<string> {
    return sendAppStoreCall(buildEditListingMsg(caller, s, was), LISTING_MEMO.edit, EDIT_GAS_WANTED, () => assertEditApplies(caller, s, was))
}

export function submitDelistApp(caller: string, pkgPath: string): Promise<string> {
    return sendAppStoreCall(buildDelistAppMsg(caller, pkgPath), LISTING_MEMO.delist, DELIST_GAS_WANTED, () => assertDelistApplies(caller, pkgPath))
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
