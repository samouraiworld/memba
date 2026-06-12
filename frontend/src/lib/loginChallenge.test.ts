import { describe, it, expect } from "vitest"
import {
    CLIENT_MAGIC,
    LOGIN_PKG_PATH,
    LOGIN_FUNC,
    loginChallengeMemo,
    buildLoginChallengeDoc,
    buildTokenRequestInfo,
    adenaPubKeyToJSON,
} from "./loginChallenge"

describe("buildTokenRequestInfo", () => {
    const base = {
        nonceB64: "bm9uY2U=",
        expiration: "2026-06-12T10:00:00Z",
        serverSignatureB64: "c2ln",
        boundPubkeyHash: "abc123",
        chainId: "test12",
    }

    it("echoes chainId into BOTH info.chainId AND info.challenge.chainId (AUTH-CHAINID round-trip)", () => {
        // Regression guard: dropping challenge.chainId breaks ValidateChallenge's
        // server-signature check (the GetToken 403 outage).
        const info = buildTokenRequestInfo({ ...base, userPubkeyJson: "{pk}" })
        const challenge = info.challenge as Record<string, unknown>
        expect(challenge.chainId).toBe("test12")
        expect(info.chainId).toBe("test12")
        expect(challenge.nonce).toBe("bm9uY2U=")
        expect(challenge.serverSignature).toBe("c2ln")
        expect(challenge.boundPubkeyHash).toBe("abc123")
        expect(info.kind).toBe(CLIENT_MAGIC)
        expect(info.userBech32Prefix).toBe("g")
        expect(info.userPubkeyJson).toBe("{pk}")
    })

    it("uses userAddress (not pubkey) when no pubkey is available", () => {
        const info = buildTokenRequestInfo({ ...base, userAddress: "g1abc" })
        expect(info.userAddress).toBe("g1abc")
        expect("userPubkeyJson" in info).toBe(false)
    })
})

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

    it("builds the backend's sentinel /vm.m_call with caller and args:null (matches Adena)", () => {
        expect(doc.tx.msg).toHaveLength(1)
        const msg = doc.tx.msg[0]
        // Field set must match backend LoginChallengeSignBytes exactly. args is null
        // (not omitted, not []) to match Adena's proto-roundtrip form.
        expect(msg).toEqual({
            "@type": "/vm.m_call",
            args: null,
            caller: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
            send: "",
            max_deposit: "",
            pkg_path: LOGIN_PKG_PATH,
            func: LOGIN_FUNC,
        })
        expect(msg.args).toBeNull()
        expect(LOGIN_PKG_PATH).toBe("gno.land/r/memba/login")
        expect(LOGIN_FUNC).toBe("ProveKeyOwnership")
    })
})

describe("adenaPubKeyToJSON", () => {
    it("converts Adena's @type pubkey to the backend's tendermint type form", () => {
        // Adena sign response: { "@type":"/tm.PubKeySecp256k1", value:"<b64>" }
        expect(adenaPubKeyToJSON("A+FhNtsX")).toBe(
            '{"type":"tendermint/PubKeySecp256k1","value":"A+FhNtsX"}',
        )
    })
})
