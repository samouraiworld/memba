/**
 * loginErrors — the session-account rejection must never leak the backend
 * error code or env-var name to users; everything else passes through.
 */
import { describe, it, expect } from "vitest"
import { humanizeLoginError, SESSION_ACCOUNT_LOGIN_MSG, SESSION_REJECT_CODE } from "./loginErrors"

describe("humanizeLoginError", () => {
    it("maps the session-account rejection to human guidance (no leaks)", () => {
        const raw = new Error(
            `[unknown] failed to unmarshal token request info (${SESSION_REJECT_CODE}: strict — set MEMBA_ACCEPT_SESSION_PUBKEYS=1 to opt in)`,
        )
        const out = humanizeLoginError(raw)
        expect(out).toBe(SESSION_ACCOUNT_LOGIN_MSG)
        expect(out).not.toContain("MEMBA_ACCEPT_SESSION_PUBKEYS")
        expect(out).not.toContain(SESSION_REJECT_CODE)
    })

    it("matches the code anywhere in a wrapped/prefixed message, Error or string", () => {
        expect(humanizeLoginError(new Error(`rpc error: ${SESSION_REJECT_CODE}`))).toBe(SESSION_ACCOUNT_LOGIN_MSG)
        expect(humanizeLoginError(`${SESSION_REJECT_CODE} inline string`)).toBe(SESSION_ACCOUNT_LOGIN_MSG)
    })

    it("passes other errors through untouched", () => {
        expect(humanizeLoginError(new Error("Authentication failed"))).toBe("Authentication failed")
    })

    it("falls back for non-Error throws and empty messages", () => {
        expect(humanizeLoginError(undefined)).toBe("Login failed")
        expect(humanizeLoginError(new Error(""))).toBe("Login failed")
        expect(humanizeLoginError({ weird: true }, "Sign-in failed")).toBe("Sign-in failed")
    })
})
