import { describe, it, expect } from "vitest"
import {
    isBotUserAgent,
    isTombstone,
    escapeHtml,
    truncate,
    shortAddress,
    renderOgPage,
    type OgPost,
} from "./feedOg"

const live: OgPost = {
    id: "42",
    author: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c",
    body: "Hello world from the Memba feed!",
    replyCount: 2,
}

describe("isBotUserAgent", () => {
    it("matches the link-unfurl crawlers we care about", () => {
        const bots = [
            "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
            "Twitterbot/1.0",
            "TelegramBot (like TwitterBot)",
            "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
            "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
            "WhatsApp/2.23.20.0 A",
            "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
        ]
        for (const ua of bots) expect(isBotUserAgent(ua), ua).toBe(true)
    })

    it("does NOT match a normal mobile/desktop browser", () => {
        expect(
            isBotUserAgent(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            ),
        ).toBe(false)
        expect(
            isBotUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            ),
        ).toBe(false)
    })

    it("treats a missing/empty UA as non-bot (serve the SPA)", () => {
        expect(isBotUserAgent("")).toBe(false)
        expect(isBotUserAgent(null)).toBe(false)
        expect(isBotUserAgent(undefined)).toBe(false)
    })
})

describe("isTombstone", () => {
    it("is true for a hidden or a deleted post, false for a live one", () => {
        expect(isTombstone({ hidden: true })).toBe(true)
        expect(isTombstone({ deleted: true })).toBe(true)
        expect(isTombstone({ hidden: false, deleted: false })).toBe(false)
        expect(isTombstone({})).toBe(false)
    })
})

describe("escapeHtml", () => {
    it("escapes the characters that could break out of a meta content attribute", () => {
        expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
            "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
        )
    })
})

describe("truncate", () => {
    it("leaves short strings intact and ellipsizes long ones", () => {
        expect(truncate("short", 200)).toBe("short")
        const long = "a".repeat(300)
        const out = truncate(long, 200)
        expect(out.length).toBeLessThanOrEqual(201) // 200 + ellipsis char
        expect(out.endsWith("…")).toBe(true)
    })
})

describe("shortAddress", () => {
    it("abbreviates a gno bech32 address", () => {
        expect(shortAddress("g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c")).toBe("g1747t…kx59c")
    })
})

describe("renderOgPage — live post", () => {
    const html = renderOgPage({
        root: live,
        permalink: "https://memba.samourai.app/feed/post/42",
        ogImage: "https://memba.samourai.app/og-image.jpg",
    })

    it("emits the post body as the og/twitter description", () => {
        expect(html).toContain(`property="og:description" content="Hello world from the Memba feed!"`)
        expect(html).toContain(`name="twitter:description" content="Hello world from the Memba feed!"`)
    })

    it("sets og:url to the canonical permalink and og:image to the card", () => {
        expect(html).toContain(`property="og:url" content="https://memba.samourai.app/feed/post/42"`)
        expect(html).toContain(`property="og:image" content="https://memba.samourai.app/og-image.jpg"`)
        expect(html).toContain(`name="twitter:card" content="summary_large_image"`)
    })

    it("names the author (abbreviated) in the title", () => {
        expect(html).toContain("g1747t…kx59c")
    })

    it("includes a canonical link and a human fallback link to the permalink", () => {
        expect(html).toContain(`<link rel="canonical" href="https://memba.samourai.app/feed/post/42">`)
    })
})

describe("renderOgPage — TOMBSTONE must never leak the body (P0)", () => {
    // A flag-auto-hidden post keeps its body in the DB / RPC response (audit
    // trail). The card MUST NOT surface it. Same for a deleted/mod-removed post.
    const hiddenWithBody: OgPost = {
        id: "7",
        author: live.author,
        body: "SECRET-ILLEGAL-CONTENT-should-never-render",
        hidden: true,
    }
    const deleted: OgPost = { id: "8", author: live.author, body: "", deleted: true }

    for (const [label, root] of [
        ["hidden-with-body", hiddenWithBody],
        ["deleted", deleted],
    ] as const) {
        it(`(${label}) renders a generic unavailable card, no body`, () => {
            const html = renderOgPage({
                root,
                permalink: "https://memba.samourai.app/feed/post/" + root.id,
                ogImage: "https://memba.samourai.app/og-image.jpg",
            })
            expect(html).not.toContain("SECRET-ILLEGAL-CONTENT")
            expect(html).toContain("no longer available")
        })
    }
})

describe("renderOgPage — escaping & length", () => {
    it("HTML-escapes a hostile body so it can't inject markup into the meta tags", () => {
        const html = renderOgPage({
            root: { ...live, body: `"><script>alert(1)</script>` },
            permalink: "https://memba.samourai.app/feed/post/42",
            ogImage: "https://memba.samourai.app/og-image.jpg",
        })
        expect(html).not.toContain("<script>alert(1)</script>")
        expect(html).toContain("&lt;script&gt;")
    })

    it("truncates a very long body in the description", () => {
        const html = renderOgPage({
            root: { ...live, body: "z".repeat(500) },
            permalink: "https://memba.samourai.app/feed/post/42",
            ogImage: "https://memba.samourai.app/og-image.jpg",
        })
        expect(html).toContain("…")
        expect(html).not.toContain("z".repeat(300))
    })
})
