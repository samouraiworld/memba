import { describe, expect, it } from "vitest"
import { walletBearer } from "./walletBearer"

describe("walletBearer", () => {
    it("sends the session token with the backend's snake_case field names", () => {
        const header = walletBearer({ nonce: "n", expiration: "e", userAddress: "g1me", serverSignature: "sig", chainId: "gnoland-1" } as never)
        expect(header.startsWith("Bearer ")).toBe(true)
        expect(JSON.parse(header.slice(7))).toEqual({ nonce: "n", expiration: "e", user_address: "g1me", server_signature: "sig", chain_id: "gnoland-1" })
    })
})
