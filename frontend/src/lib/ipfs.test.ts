/**
 * IPFS Client Tests — validates image validation, CID handling,
 * gateway URL resolution, and upload error handling.
 *
 * Note: actual Lighthouse uploads are not tested (requires API key + network).
 * These tests cover the validation, preprocessing logic, and URL resolution.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import {
    isValidImageMime,
    isValidCid,
    getIpfsGatewayUrl,
    getIpfsGatewayUrls,
    resolveAvatarUrl,
    uploadToLighthouse,
    uploadImage,
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

// ── getIpfsGatewayUrls (fallback chain) ──────────────────────

describe("getIpfsGatewayUrls", () => {
    it("returns all 3 gateway URLs for a CID", () => {
        const cid = "bafybei" + "x".repeat(52)
        const urls = getIpfsGatewayUrls(cid)
        expect(urls).toHaveLength(3)
        expect(urls[0]).toContain("lighthouse.storage")
        expect(urls[1]).toContain("ipfs.io")
        expect(urls[2]).toContain("dweb.link")
    })

    it("primary gateway is first", () => {
        const cid = "bafybei" + "z".repeat(52)
        const urls = getIpfsGatewayUrls(cid)
        expect(urls[0]).toBe(getIpfsGatewayUrl(cid))
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

// ── uploadToLighthouse — N2 security: always via the auth-gated proxy ─────────

describe("uploadToLighthouse (N2 — no client-side key)", () => {
    afterEach(() => { vi.unstubAllGlobals() })

    it("POSTs to the backend /api/upload/avatar proxy, never to node.lighthouse.storage", async () => {
        const calls: string[] = []
        vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
            calls.push(String(url))
            return { ok: true, json: async () => ({ cid: "bafybei" + "a".repeat(52) }) } as Response
        }))

        const blob = new Blob(["x"], { type: "image/webp" })
        const res = await uploadToLighthouse(blob)

        expect(res.cid).toContain("bafybei")
        expect(calls.some(u => u.includes("/api/upload/avatar"))).toBe(true)
        expect(calls.some(u => u.includes("node.lighthouse.storage"))).toBe(false)
    })
})

// ── uploadImage — App Store media via the /api/upload/image proxy ─────────────

describe("uploadImage (2b — App Store media, bare CID)", () => {
    afterEach(() => { vi.unstubAllGlobals() })

    it("POSTs to /api/upload/image (never node.lighthouse.storage) and returns a bare CID", async () => {
        const calls: string[] = []
        const cid = "bafybei" + "c".repeat(52)
        vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
            calls.push(String(url))
            return { ok: true, json: async () => ({ cid }) } as Response
        }))

        const file = new File(["icon-bytes"], "icon.png", { type: "image/png" })
        const result = await uploadImage(file)

        // Bare CID: not ipfs://-prefixed, not a gateway URL — exactly what the realm stores.
        expect(result).toBe(cid)
        expect(result.startsWith("ipfs://")).toBe(false)
        expect(result.startsWith("http")).toBe(false)
        expect(isValidCid(result)).toBe(true)

        expect(calls.some(u => u.includes("/api/upload/image"))).toBe(true)
        expect(calls.some(u => u.includes("/api/upload/avatar"))).toBe(false)
        expect(calls.some(u => u.includes("node.lighthouse.storage"))).toBe(false)
    })

    it("client-rejects a non-image (SVG) before any network call", async () => {
        const fetchSpy = vi.fn()
        vi.stubGlobal("fetch", fetchSpy)

        const svg = new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })
        await expect(uploadImage(svg)).rejects.toThrow(/unsupported image type/i)
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})
