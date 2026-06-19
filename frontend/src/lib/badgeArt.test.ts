import { describe, it, expect } from "vitest"
import { questBadgeSvg, rankBadgeSvg, rankTierOf } from "./badgeArt"

describe("badgeArt", () => {
    it("questBadgeSvg renders a category-colored shield with the icon", () => {
        const svg = questBadgeSvg("developer", "📦")
        expect(svg).toContain("<svg")
        expect(svg.trimEnd().endsWith("</svg>")).toBe(true)
        expect(svg).toContain("#00d4aa") // developer color
        expect(svg).toContain("📦")
        expect(svg).toContain("quest badge")
    })

    it("questBadgeSvg escapes angle brackets in the icon", () => {
        const svg = questBadgeSvg("developer", "<script>")
        expect(svg).not.toContain("<script>")
        expect(svg).toContain("&lt;script&gt;")
    })

    it("rankBadgeSvg renders the tier's color + number", () => {
        const svg = rankBadgeSvg(3) // Gold Architect, #ffd700
        expect(svg).toContain("#ffd700")
        expect(svg).toContain(">3</text>")
        expect(svg).toContain("rank badge")
    })

    it("rankBadgeSvg falls back gracefully for an out-of-range tier", () => {
        expect(rankBadgeSvg(99)).toContain("<svg")
    })

    it("rankTierOf parses rank ids", () => {
        expect(rankTierOf("rank:3")).toBe(3)
        expect(rankTierOf("connect-wallet")).toBeNull()
        expect(rankTierOf("rank:x")).toBeNull()
    })
})
