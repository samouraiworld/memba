/**
 * loginErrors — maps the backend's session-account sign-in rejection to human copy.
 *
 * Wire contract (backend/internal/service/auth_rpc.go `tokenDenied`): auth
 * failures reach clients message-less by design, with ONE exception — the
 * session/subaccount pubkey rejection rides the wire as the bare code
 * `AUTH-SESSION-REJECT-01` (no env var, no internals; the operator opt-in hint
 * stays in server logs). Session accounts shipped in Adena on 2026-07-11;
 * until the opt-in review lands, Memba sign-in requires the main account.
 *
 * @module lib/loginErrors
 */

/** Backend rejection code for session/subaccount pubkey payloads (bare, wire-safe). */
export const SESSION_REJECT_CODE = "AUTH-SESSION-REJECT-01"

/** What a user should actually do about it. */
export const SESSION_ACCOUNT_LOGIN_MSG =
    "Session accounts aren't supported yet — switch Adena to your main account and try again."

/**
 * Backend rejection code for a login aimed at a chain the server does not serve
 * (F-29). Second use of the same bare-code exception, added because the failure
 * it replaces was invisible: the server used to MINT a token for whatever chain
 * the client asked for and only reject it afterwards, on every call, so sign-in
 * appeared to succeed and the app then behaved as if permanently broken.
 */
export const CHAIN_MISMATCH_CODE = "AUTH-CHAINID-MISMATCH-01"

/** What a user should actually do about it. */
export const CHAIN_MISMATCH_LOGIN_MSG =
    "Your wallet is on a different network than this page — switch networks and try again."

/**
 * Human copy for a failed sign-in: session-account rejections get the guidance
 * above; anything else passes through, with `fallback` covering non-Error
 * throws and empty messages.
 */
export function humanizeLoginError(err: unknown, fallback = "Login failed"): string {
    const msg = err instanceof Error ? err.message : typeof err === "string" ? err : ""
    if (!msg) return fallback
    if (msg.includes(SESSION_REJECT_CODE)) return SESSION_ACCOUNT_LOGIN_MSG
    if (msg.includes(CHAIN_MISMATCH_CODE)) return CHAIN_MISMATCH_LOGIN_MSG
    return msg
}
