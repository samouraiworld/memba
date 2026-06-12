import { describe, it, expect } from "vitest"
import {
    CLIENT_MAGIC,
    LOGIN_PKG_PATH,
    LOGIN_FUNC,
    loginChallengeMemo,
    buildLoginChallengeDoc,
} from "./loginChallenge"

describe("loginChallengeMemo", () => {
    it("is the client magic plus the base64 nonce (must match the backend memo)", () => {
        expect(loginChallengeMemo("AAEC")).toBe("Login to Memba Multisig Service | nonce: AAEC")
        expect(CLIENT_MAGIC).toBe("Login to Memba Multisig Service")
    })
})

describe("buildLoginChallengeDoc", () => {
    const doc = buildLoginChallengeDoc("test12", "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", "AAEC")

    it("is a non-broadcast, zero-fee, zero-account/sequence sentinel m_call", () => {
        expect(doc.chainId).toBe("test12")
        expect(doc.accountNumber).toBe("0")
        expect(doc.sequence).toBe("0")
        expect(doc.tx.fee).toEqual({ gas_wanted: "0", gas_fee: "" })
        expect(doc.tx.signatures).toBeNull()
    })

    it("carries the binding nonce in the memo", () => {
        expect(doc.tx.memo).toBe("Login to Memba Multisig Service | nonce: AAEC")
    })

    it("builds exactly the backend's sentinel /vm.m_call with caller and NO args", () => {
        expect(doc.tx.msg).toHaveLength(1)
        const msg = doc.tx.msg[0]
        // Field set must match backend LoginChallengeSignBytes exactly (args omitted).
        expect(msg).toEqual({
            "@type": "/vm.m_call",
            caller: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
            send: "",
            max_deposit: "",
            pkg_path: LOGIN_PKG_PATH,
            func: LOGIN_FUNC,
        })
        expect("args" in msg).toBe(false)
        expect(LOGIN_PKG_PATH).toBe("gno.land/r/memba/login")
        expect(LOGIN_FUNC).toBe("ProveKeyOwnership")
    })
})
