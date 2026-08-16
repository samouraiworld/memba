/**
 * loginErrors — the session-account rejection must map to human guidance and
 * never leak the backend code or env-var name; everything else passes through.
 * Message shapes mirror the REAL wire: connect-es renders a ConnectError as
 * "[permission_denied] <message>", where <message> is the bare code the
 * backend's tokenDenied puts on the wire.
 */
import { describe, it, expect } from "vitest"
import {
    humanizeLoginError, SESSION_ACCOUNT_LOGIN_MSG, SESSION_REJECT_CODE,
    CHAIN_MISMATCH_CODE, CHAIN_MISMATCH_LOGIN_MSG,
    ACTIVATION_REQUIRED_CODE, ACTIVATION_LOGIN_MSG,
} from "./loginErrors"

describe("humanizeLoginError", () => {
    it("maps the wire-shaped ConnectError message to human guidance (no leaks)", () => {
        const wire = new Error(`[permission_denied] ${SESSION_REJECT_CODE}`)
        const out = humanizeLoginError(wire)
        expect(out).toBe(SESSION_ACCOUNT_LOGIN_MSG)
        expect(out).not.toContain(SESSION_REJECT_CODE)
        expect(out).not.toContain("MEMBA_ACCEPT_SESSION_PUBKEYS")
    })

    it("matches the code in any wrapper, Error or string", () => {
        expect(humanizeLoginError(new Error(`rpc error: ${SESSION_REJECT_CODE}`))).toBe(SESSION_ACCOUNT_LOGIN_MSG)
        expect(humanizeLoginError(`${SESSION_REJECT_CODE} inline`)).toBe(SESSION_ACCOUNT_LOGIN_MSG)
    })

    it("passes other errors through untouched", () => {
        expect(humanizeLoginError(new Error("[permission_denied]"))).toBe("[permission_denied]")
        expect(humanizeLoginError(new Error("Authentication failed"))).toBe("Authentication failed")
    })

    it("falls back for non-Error throws and empty messages", () => {
        expect(humanizeLoginError(undefined)).toBe("Login failed")
        expect(humanizeLoginError(new Error(""))).toBe("Login failed")
        expect(humanizeLoginError({ weird: true }, "Sign-in failed")).toBe("Sign-in failed")
    })

    // F-29: the backend now REFUSES to mint for a chain it does not serve
    // instead of issuing a token that 401s on every later call. The refusal is
    // only useful if it reaches the user as something they can act on.
    it("maps the chain-mismatch code to actionable guidance", () => {
        expect(humanizeLoginError(new Error(CHAIN_MISMATCH_CODE))).toBe(CHAIN_MISMATCH_LOGIN_MSG)
        expect(humanizeLoginError(`[permission_denied] ${CHAIN_MISMATCH_CODE}`)).toBe(CHAIN_MISMATCH_LOGIN_MSG)
        // Tells the user what to DO, and leaks no server configuration.
        expect(CHAIN_MISMATCH_LOGIN_MSG).toMatch(/switch networks/i)
        expect(CHAIN_MISMATCH_LOGIN_MSG).not.toMatch(/topaz|sapphire|MEMBA_|GNO_CHAIN_ID/i)
    })

    // AUTH-ACTIVATE-01: an untransacted wallet on an enforced-auth chain is
    // refused at sign-in. On a freshly reset network that is EVERY user's
    // first login, so the refusal must arrive as a next step, not a dead end.
    it("maps the activation-required code to actionable guidance", () => {
        expect(humanizeLoginError(new Error(ACTIVATION_REQUIRED_CODE))).toBe(ACTIVATION_LOGIN_MSG)
        expect(humanizeLoginError(`[permission_denied] ${ACTIVATION_REQUIRED_CODE}`)).toBe(ACTIVATION_LOGIN_MSG)
        // Tells the user what to DO, and leaks no server configuration.
        expect(ACTIVATION_LOGIN_MSG).toMatch(/activate/i)
        expect(ACTIVATION_LOGIN_MSG).not.toMatch(/MEMBA_|pubkey|AUTH-/i)
    })
})
