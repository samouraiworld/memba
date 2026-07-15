/**
 * useAuth token persistence — regression guard for AUTH-CHAINID-01.
 *
 * The backend signs the auth token over ALL its fields (nonce, userAddress,
 * expiration, chainId). REST endpoints (arcade certify, IPFS upload, analyst
 * report) send the localStorage-stored token verbatim as a `Bearer` header; the
 * server json.Unmarshals it back into a proto and re-verifies the signature. If
 * the persisted JSON drops `chainId`, the reconstructed proto has chainId="" and
 * the signature no longer matches → 401 "invalid or expired token". This pins
 * that every signed field round-trips through storage.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { create } from "@bufbuild/protobuf"
import { TokenSchema } from "../gen/memba/v1/memba_pb"
import { saveToken, loadToken } from "./useAuth"

const TOKEN_KEY = "memba_auth_token"

describe("useAuth token persistence", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it("persists chainId so the REST bearer token round-trips (AUTH-CHAINID-01)", () => {
        const token = create(TokenSchema, {
            nonce: "bm9uY2U=",
            userAddress: "g1player",
            expiration: "2099-01-01T00:00:00Z",
            chainId: "test-13",
            serverSignature: "c2ln",
        })

        saveToken(token)

        // The raw stored string is exactly what REST endpoints send as Bearer.
        const raw = localStorage.getItem(TOKEN_KEY)
        expect(raw).not.toBeNull()
        const parsed = JSON.parse(raw as string)
        expect(parsed.chainId).toBe("test-13")

        // And it rehydrates with chainId intact.
        expect(loadToken()?.chainId).toBe("test-13")
    })
})
