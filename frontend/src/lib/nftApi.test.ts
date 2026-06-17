import { describe, it, expect } from "vitest"
import { nftImageUrl, nftMetadataUrl } from "./nftApi"
import { formatGnot, truncateAddr, relativeTime } from "./format"

describe("nftImageUrl", () => {
    it("encodes ipfs:// URI", () => {
        const url = nftImageUrl("ipfs://QmFoo123")
        expect(url).toContain("/api/nft/image?uri=")
        expect(url).toContain(encodeURIComponent("ipfs://QmFoo123"))
    })

    it("encodes https:// URI", () => {
        const url = nftImageUrl("https://example.com/img.png")
        expect(url).toContain("/api/nft/image?uri=")
        expect(decodeURIComponent(url.split("uri=")[1])).toBe("https://example.com/img.png")
    })

    it("handles empty string without throwing", () => {
        expect(() => nftImageUrl("")).not.toThrow()
    })
})

describe("nftMetadataUrl", () => {
    it("builds metadata proxy URL", () => {
        const url = nftMetadataUrl("ipfs://QmBar456")
        expect(url).toContain("/api/nft/metadata?uri=")
    })
})

describe("formatGnot", () => {
    it("formats zero", () => {
        expect(formatGnot(0)).toBe("0 GNOT")
    })

    it("formats 1 GNOT (1_000_000 ugnot)", () => {
        expect(formatGnot(1_000_000)).toBe("1 GNOT")
    })

    it("formats 1.5 GNOT", () => {
        expect(formatGnot(1_500_000)).toBe("1.5 GNOT")
    })

    it("formats 1.50 GNOT with trailing zero stripped", () => {
        expect(formatGnot(1_500_000)).not.toContain("1.50")
    })

    it("formats very small amount with more precision", () => {
        const r = formatGnot(1000) // 0.001 GNOT
        expect(r).toContain("0.001")
        expect(r).toContain("GNOT")
    })

    it("accepts bigint", () => {
        expect(formatGnot(BigInt(2_000_000))).toBe("2 GNOT")
    })

    it("strips trailing zeros from 2dp", () => {
        expect(formatGnot(5_500_000)).toBe("5.5 GNOT")
    })
})

describe("truncateAddr", () => {
    it("truncates long address", () => {
        const addr = "g1abc123456789xyz9999"
        const r = truncateAddr(addr)
        expect(r).toContain("…")
        expect(r.startsWith("g1abc123")).toBe(true)
    })

    it("leaves short address unchanged", () => {
        const short = "g1abc"
        expect(truncateAddr(short)).toBe(short)
    })
})

describe("relativeTime", () => {
    it("returns seconds ago for recent timestamps", () => {
        const ts = new Date(Date.now() - 30_000).toISOString()
        expect(relativeTime(ts)).toMatch(/\ds ago/)
    })

    it("returns minutes ago", () => {
        const ts = new Date(Date.now() - 5 * 60_000).toISOString()
        expect(relativeTime(ts)).toBe("5m ago")
    })

    it("returns hours ago", () => {
        const ts = new Date(Date.now() - 3 * 3600_000).toISOString()
        expect(relativeTime(ts)).toBe("3h ago")
    })

    it("returns days ago", () => {
        const ts = new Date(Date.now() - 2 * 86_400_000).toISOString()
        expect(relativeTime(ts)).toBe("2d ago")
    })

    it("handles unix seconds number", () => {
        const secs = Math.floor((Date.now() - 120_000) / 1000)
        expect(relativeTime(secs)).toBe("2m ago")
    })

    it("returns — for invalid input", () => {
        expect(relativeTime("not-a-date")).toBe("—")
    })
})
