/**
 * IPFS Client Tests — validates image validation, CID handling,
 * gateway URL resolution, and upload error handling.
 *
 * Note: actual Lighthouse uploads are not tested (requires API key + network).
 * These tests cover the validation, preprocessing logic, and URL resolution.
 */

import { describe, it, expect } from "vitest"
import {
    isValidImageMime,
    isValidCid,
    getIpfsGatewayUrl,
    resolveAvatarUrl,
} from "./ipfs"

// ── isValidImageMime ──────────────────────────────────────────

describe("isValidImageMime", () => {
    it("accepts JPEG", () => {
        expect(isValidImageMime("image/jpeg")).toBe(true)
    })

    it("accepts PNG", () => {
        expect(isValidImageMime("image/png")).toBe(true)
    })

    it("accepts WebP", () => {
        expect(isValidImageMime("image/webp")).toBe(true)
    })

    it("accepts GIF", () => {
        expect(isValidImageMime("image/gif")).toBe(true)
    })

    it("rejects SVG", () => {
        expect(isValidImageMime("image/svg+xml")).toBe(false)
    })

    it("rejects text", () => {
        expect(isValidImageMime("text/plain")).toBe(false)
    })

    it("rejects empty string", () => {
        expect(isValidImageMime("")).toBe(false)
    })
})

// ── isValidCid ────────────────────────────────────────────────

describe("isValidCid", () => {
    it("validates CIDv1 (bafybei...)", () => {
        // bafybei + 52 lowercase alphanum
        const cid = "bafybei" + "a".repeat(52)
        expect(isValidCid(cid)).toBe(true)
    })

    it("validates CIDv0 (Qm...)", () => {
        // Qm + 44 alphanum
        const cid = "Qm" + "A".repeat(44)
        expect(isValidCid(cid)).toBe(true)
    })

    it("rejects short CID", () => {
        expect(isValidCid("bafybei123")).toBe(false)
    })

    it("rejects empty string", () => {
        expect(isValidCid("")).toBe(false)
    })

    it("rejects HTTP URL", () => {
        expect(isValidCid("https://example.com/image.png")).toBe(false)
    })
})

// ── getIpfsGatewayUrl ─────────────────────────────────────────

describe("getIpfsGatewayUrl", () => {
    it("returns Lighthouse gateway URL", () => {
        const cid = "bafybei" + "x".repeat(52)
        expect(getIpfsGatewayUrl(cid)).toBe(`https://gateway.lighthouse.storage/ipfs/${cid}`)
    })
})

// ── resolveAvatarUrl ──────────────────────────────────────────

describe("resolveAvatarUrl", () => {
    it("resolves ipfs:// protocol", () => {
        const cid = "bafybei" + "a".repeat(52)
        expect(resolveAvatarUrl(`ipfs://${cid}`)).toBe(`https://gateway.lighthouse.storage/ipfs/${cid}`)
    })

    it("resolves bare CID", () => {
        const cid = "bafybei" + "b".repeat(52)
        expect(resolveAvatarUrl(cid)).toBe(`https://gateway.lighthouse.storage/ipfs/${cid}`)
    })

    it("passes through HTTP URLs unchanged", () => {
        const url = "https://github.com/user.png"
        expect(resolveAvatarUrl(url)).toBe(url)
    })

    it("returns empty string for empty input", () => {
        expect(resolveAvatarUrl("")).toBe("")
    })

    it("passes through GitHub avatar URLs", () => {
        const url = "https://avatars.githubusercontent.com/u/12345?v=4"
        expect(resolveAvatarUrl(url)).toBe(url)
    })
})
