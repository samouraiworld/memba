import { parseSiweMessage } from "viem/siwe"
import { describe, expect, it } from "vitest"
import { buildSiweMessage } from "./siwe"

const frame = {
    nonce: "0123456789abcdef0123456789abcdef",
    chainId: "eip155:84532",
    domain: "deploy-preview-12--membaos.netlify.app",
    uri: "https://deploy-preview-12--membaos.netlify.app",
    issuedAt: "2026-10-07T12:00:00Z",
    expiration: "2026-10-07T12:10:00Z",
    statement: "Sign in to Memba.",
}

describe("buildSiweMessage", () => {
    it("writes the EIP-4361 message the server's challenge frames, field by field", () => {
        const text = buildSiweMessage(frame, "0xabcdef0123456789abcdef0123456789abcdef01")
        expect(text).toBe([
            "deploy-preview-12--membaos.netlify.app wants you to sign in with your Ethereum account:",
            "0xabCDeF0123456789AbcdEf0123456789aBCDEF01",
            "",
            "Sign in to Memba.",
            "",
            "URI: https://deploy-preview-12--membaos.netlify.app",
            "Version: 1",
            "Chain ID: 84532",
            "Nonce: 0123456789abcdef0123456789abcdef",
            "Issued At: 2026-10-07T12:00:00.000Z",
            "Expiration Time: 2026-10-07T12:10:00.000Z",
        ].join("\n"))
        expect(parseSiweMessage(text)).toMatchObject({ chainId: 84532, nonce: frame.nonce, domain: frame.domain, uri: frame.uri })
    })

    it("refuses a challenge for a chain that is not EIP-155", () => {
        expect(() => buildSiweMessage({ ...frame, chainId: "gnoland-1" }, "0xabcdef0123456789abcdef0123456789abcdef01")).toThrow("Not an EVM chain: gnoland-1")
    })
})
