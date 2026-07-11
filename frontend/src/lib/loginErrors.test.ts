/**
 * loginErrors — the session-account rejection must map to human guidance and
 * never leak the backend code or env-var name; everything else passes through.
 * Message shapes mirror the REAL wire: connect-es renders a ConnectError as
 * "[permission_denied] <message>", where <message> is the bare code the
 * backend's tokenDenied puts on the wire.
 */
import { describe, it, expect } from "vitest"
import { humanizeLoginError, SESSION_ACCOUNT_LOGIN_MSG, SESSION_REJECT_CODE } from "./loginErrors"

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
})
