import { describe, expect, it, vi } from "vitest"
import type { BlogArticle } from "./blogParser"
import { articleBodyHtml, readingTime } from "./blogView"
import { formatNewsDate } from "./newsDate"

const article = (over: Partial<BlogArticle>): BlogArticle => ({ slug: "post", title: "Post", date: "2026-07-08", description: "", tags: [], body: "", ...over })
const dom = (html: string) => new DOMParser().parseFromString(html, "text/html").body

describe("blogView", () => {
    it("estimates reading time at about 200 words a minute, never under a minute", () => {
        expect(readingTime("")).toBe("1 min read")
        expect(readingTime("word ".repeat(200))).toBe("1 min read")
        expect(readingTime("word ".repeat(900))).toBe("5 min read")
    })

    it("formats a calendar date without shifting the day, west of UTC too", () => {
        vi.stubEnv("TZ", "America/Los_Angeles")
        try {
            // The zone is in force here: a date parsed as UTC midnight falls on the day before.
            expect(new Date("2026-07-08").getDate()).toBe(7)
            expect(formatNewsDate("2026-07-08")).toBe("July 8, 2026")
            expect(formatNewsDate("2026-01-01")).toBe("January 1, 2026")
        } finally {
            vi.unstubAllEnvs()
        }
    })

    it("renders markdown, escapes raw HTML and defuses unsafe links", () => {
        const body = dom(articleBodyHtml(article({ body: "## Heading\n\n<script>alert(1)</script> [trap](javascript:alert(1)) [out](https://example.org)" })))
        expect(body.querySelector("h2")?.textContent).toBe("Heading")
        expect(body.querySelector("script")).toBeNull()
        expect(body.textContent).toContain("<script>alert(1)</script>")
        const [trap, out] = [...body.querySelectorAll("a")]
        expect(trap.getAttribute("href")).toBe("#")
        expect(out.getAttribute("target")).toBe("_blank")
        expect(out.getAttribute("rel")).toBe("noopener noreferrer")
    })

    it("passes the sanitizer: an in-app link keeps the tab", () => {
        const link = dom(articleBodyHtml(article({ body: "[dao](/mainnet/dao)" }))).querySelector("a")!
        expect(link.getAttribute("href")).toBe("/mainnet/dao")
        expect(link.hasAttribute("target")).toBe(false)
    })

    it("shows images for a static post only, never for an on-chain copy", () => {
        const body = "![diagram](https://example.org/diagram.png)"
        expect(dom(articleBodyHtml(article({ body }))).querySelector("img")?.getAttribute("src")).toBe("https://example.org/diagram.png")
        expect(dom(articleBodyHtml(article({ body, source: "onchain" }))).querySelector("img")).toBeNull()
    })
})
