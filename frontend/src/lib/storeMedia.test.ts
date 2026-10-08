import { describe, expect, it } from "vitest"
import { cidImageUrl, hueAccent, mediaKeyFor, resolveMedia, type StoreMedia } from "./storeMedia"

const CID = `bafy${"a".repeat(55)}`
const manifest: Record<string, StoreMedia> = {
    gnoswap: { logo: "/store/gnoswap/logo.svg", cover: "/store/gnoswap/cover.webp", screenshots: ["/store/gnoswap/shot-1.webp"], accent: "#1FB89A", sources: [] },
    bare: { screenshots: [], accent: "#123456", sources: [] },
}

describe("resolveMedia", () => {
    it("prefers curated media over the listing's CIDs", () => {
        expect(resolveMedia("gnoswap", { iconCID: CID, screenshotCIDs: [CID] }, "x", manifest)).toEqual({
            logo: "/store/gnoswap/logo.svg", cover: "/store/gnoswap/cover.webp", screenshots: ["/store/gnoswap/shot-1.webp"], accent: "#1FB89A",
        })
    })
    it("uses the listing's icon and screenshots when nothing is curated, the first screenshot as cover", () => {
        const media = resolveMedia(null, { iconCID: CID, screenshotCIDs: [CID, "not-a-cid"] }, "seed", manifest)
        expect(media.logo).toBe(cidImageUrl(CID))
        expect(media.screenshots).toEqual([cidImageUrl(CID)])
        expect(media.cover).toBe(cidImageUrl(CID))
        expect(media.accent).toBe(hueAccent("seed"))
    })
    it("keeps the curated accent while falling back to listing images", () => {
        expect(resolveMedia("bare", { iconCID: CID }, "x", manifest)).toEqual({ logo: cidImageUrl(CID), cover: null, screenshots: [], accent: "#123456" })
    })
    it("returns a monogram (null logo) and no cover when nothing exists", () => {
        expect(resolveMedia("unknown", null, "seed", manifest)).toEqual({ logo: null, cover: null, screenshots: [], accent: hueAccent("seed") })
    })
})

describe("mediaKeyFor", () => {
    it("uses the editorial id first, then a known realm", () => {
        expect(mediaKeyFor("adena", null)).toBe("adena")
        expect(mediaKeyFor(null, "gno.land/r/samcrew/block_party")).toBe("block-party")
        expect(mediaKeyFor(null, "gno.land/r/someone/app")).toBeNull()
    })
})

describe("hueAccent", () => {
    it("is stable per seed", () => {
        expect(hueAccent("abc")).toBe(hueAccent("abc"))
        expect(hueAccent("abc")).toMatch(/^hsl\(\d{1,3} 55% 42%\)$/)
    })
})
