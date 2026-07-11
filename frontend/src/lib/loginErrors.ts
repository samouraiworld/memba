/**
 * loginErrors — maps backend sign-in failures to human copy.
 *
 * The backend rejects Adena session/subaccount pubkey payloads fail-closed
 * (AUTH-SESSION-REJECT-01, backend/internal/auth/crypto.go): a session key must
 * never be misattributed as the main account. Its raw error message names an
 * internal env var (`MEMBA_ACCEPT_SESSION_PUBKEYS`) — operator guidance, not
 * user copy. Session accounts shipped in Adena on 2026-07-11; until the opt-in
 * review lands, Memba sign-in requires the main account.
 *
 * @module lib/loginErrors
 */

/** Backend rejection code for session/subaccount pubkey payloads. */
export const SESSION_REJECT_CODE = "AUTH-SESSION-REJECT-01"

/** What a user should actually do about it. */
export const SESSION_ACCOUNT_LOGIN_MSG =
    "Session accounts aren't supported yet — switch Adena to your main account and try again."

/**
 * Human copy for a failed sign-in: session-account rejections get the guidance
 * above; anything else passes through (server copy is user-facing elsewhere),
 * with `fallback` covering non-Error throws and empty messages.
 */
export function humanizeLoginError(err: unknown, fallback = "Login failed"): string {
    const msg = err instanceof Error ? err.message : typeof err === "string" ? err : ""
    if (!msg) return fallback
    if (msg.includes(SESSION_REJECT_CODE)) return SESSION_ACCOUNT_LOGIN_MSG
    return msg
}
