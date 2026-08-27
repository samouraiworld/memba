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

/** What a user should actually do about it. Every sign-in surface passes the
 *  PAGE's network chainId (Layout/BlockParty/arcade all send
 *  `network.chainId`), so this code always means "the server does not accept
 *  THIS page's chain" — on a newly-launched network (pearl until the owner
 *  appends it to MEMBA_ACCEPTED_CHAIN_IDS) the old "your wallet is on a
 *  different network" wording was false and circular: the wallet WAS on the
 *  page's network, and switching it changed nothing. Name the real cause and
 *  the working exit instead. */
export const CHAIN_MISMATCH_LOGIN_MSG =
    "Sign-in isn't enabled on this network yet — use the network selector to switch networks (Sapphire works) and try again."

/**
 * Backend rejection code for an address-only login on a chain where signed
 * auth is enforced (AUTH-UNSIGNED-01): the wallet has never transacted on this
 * network, so no on-chain pubkey exists and Adena (#800) will neither reveal
 * nor sign for one. Third use of the bare-code exception. After a chain reset
 * (the sapphire cutover) EVERY wallet's first sign-in lands here, so this is
 * the difference between "the whole userbase dead-ends on a generic banner"
 * and "the whole userbase is walked through activation".
 */
export const ACTIVATION_REQUIRED_CODE = "AUTH-ACTIVATE-01"

/** What a user should actually do about it. */
export const ACTIVATION_LOGIN_MSG =
    "This wallet hasn't transacted on this network yet — activate it with one small on-chain transaction to sign in."

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
    if (msg.includes(ACTIVATION_REQUIRED_CODE)) return ACTIVATION_LOGIN_MSG
    return msg
}
