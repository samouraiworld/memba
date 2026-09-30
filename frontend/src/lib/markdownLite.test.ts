/**
 * Tests for markdownLite — lightweight markdown renderer.
 * Covers all supported elements + XSS safety.
 */
import { describe, it, expect } from "vitest"
import { renderMarkdown, renderPostBody } from "./markdownLite"

describe("markdownLite", () => {
    // ── Headings ──────────────────────────────────────────

    it("renders h1-h4 headings", () => {
        expect(renderMarkdown("# Title")).toContain('<h1 class="md-h1">Title</h1>')
        expect(renderMarkdown("## Sub")).toContain('<h2 class="md-h2">Sub</h2>')
        expect(renderMarkdown("### H3")).toContain('<h3 class="md-h3">H3</h3>')
        expect(renderMarkdown("#### H4")).toContain('<h4 class="md-h4">H4</h4>')
    })

    // ── Inline formatting ─────────────────────────────────

    it("renders bold text", () => {
        const html = renderMarkdown("This is **bold** text")
        expect(html).toContain("<strong>bold</strong>")
    })

    it("renders italic text", () => {
        const html = renderMarkdown("This is *italic* text")
        expect(html).toContain("<em>italic</em>")
    })

    it("renders inline code", () => {
        const html = renderMarkdown("Use `fmt.Println` here")
        expect(html).toContain('<code class="md-inline-code">fmt.Println</code>')
    })

    // ── Links ─────────────────────────────────────────────

    it("renders links with target=_blank", () => {
        const html = renderMarkdown("[Gno](https://gno.land)")
        expect(html).toContain('href="https://gno.land"')
        expect(html).toContain('target="_blank"')
        expect(html).toContain('rel="noopener noreferrer"')
    })

    // ── XSS Safety ────────────────────────────────────────

    it("blocks protocol-relative and backslash links that browsers resolve to another host", () => {
        for (const href of ["//evil.com", "/\\evil.com", "\\\\evil.com", "\\/evil.com", "/\t/evil.com", "/\r/evil.com", " //evil.com"]) {
            const html = renderMarkdown(`[x](${href})`)
            expect(html, href).toContain('href="#"')
            expect(html, href).not.toContain("evil.com")
        }
        expect(renderMarkdown("[home](/dao/x)")).toContain('href="/dao/x"')
    })

    it("blocks javascript: protocol in links", () => {
        const html = renderMarkdown("[click](javascript:alert(1))")
        expect(html).not.toContain("javascript:")
        expect(html).toContain('href="#"')
    })

    it("blocks data: protocol in links", () => {
        const html = renderMarkdown("[click](data:text/html,<script>alert(1)</script>)")
        expect(html).not.toContain("data:")
        expect(html).toContain('href="#"')
    })

    it("escapes HTML entities in text", () => {
        const html = renderMarkdown("# <script>alert(1)</script>")
        expect(html).not.toContain("<script>")
        expect(html).toContain("&lt;script&gt;")
    })

    it("escapes HTML in code blocks", () => {
        const html = renderMarkdown("```\n<img onerror=alert(1)>\n```")
        expect(html).not.toContain("<img")
        expect(html).toContain("&lt;img")
    })

    // ── Lists ─────────────────────────────────────────────

    it("renders unordered lists", () => {
        const html = renderMarkdown("- item 1\n- item 2")
        expect(html).toContain('<ul class="md-ul">')
        expect(html).toContain("<li>item 1</li>")
        expect(html).toContain("<li>item 2</li>")
    })

    it("renders ordered lists", () => {
        const html = renderMarkdown("1. first\n2. second")
        expect(html).toContain('<ol class="md-ol">')
        expect(html).toContain("<li>first</li>")
    })

    // ── Code blocks ───────────────────────────────────────

    it("renders fenced code blocks", () => {
        const html = renderMarkdown("```go\nfunc main() {}\n```")
        expect(html).toContain('<pre class="md-code-block" data-lang="go">')
        expect(html).toContain("func main() {}")
    })

    // ── Tables ────────────────────────────────────────────

    it("renders tables", () => {
        const md = "| Name | Value |\n|---|---|\n| foo | bar |"
        const html = renderMarkdown(md)
        expect(html).toContain('<table class="md-table">')
        expect(html).toContain("<th>Name</th>")
        expect(html).toContain("<td>foo</td>")
    })

    // ── Horizontal rule ───────────────────────────────────

    it("renders horizontal rules", () => {
        const html = renderMarkdown("---")
        expect(html).toContain('<hr class="md-hr" />')
    })

    // ── Bech32 addresses ──────────────────────────────────

    it("auto-links gno addresses", () => {
        const addr = "g1" + "a".repeat(38)
        const html = renderMarkdown(`Send to ${addr} now`)
        expect(html).toContain(`/profile/${addr}`)
        expect(html).toContain('class="md-address"')
    })

    // ── Edge cases ────────────────────────────────────────

    it("returns empty string for empty input", () => {
        expect(renderMarkdown("")).toBe("")
        expect(renderMarkdown(null as unknown as string)).toBe("")
    })

    it("sends a gno.land path written without its scheme to the current network's gno.land site, not under the current page", () => {
        try {
            window.history.replaceState({}, "", "/mainnet/news")
            expect(renderMarkdown("[dao](gno.land/r/gov/dao)")).toContain('href="https://gno.land/r/gov/dao"')
            // On a testnet, mainnet's same path may be someone else's realm.
            window.history.replaceState({}, "", "/onyx/news")
            expect(renderMarkdown("[dao](gno.land/r/gov/dao)")).toContain('href="https://onyx.testnets.gno.land/r/gov/dao"')
        } finally {
            window.history.replaceState({}, "", "/")
        }
    })

    it("renders a linked image, such as a badge, as one link to where it points", () => {
        const md = "[![badge](https://img.shields.io/x.svg)](https://github.com/x)"
        const link = '<a href="https://github.com/x" target="_blank" rel="noopener noreferrer">Image: badge</a>'
        expect(renderMarkdown(md)).toBe(`<p class="md-p">${link}</p>`)
        // Feed posts use the same inline rules, unsanitized afterwards.
        expect(renderPostBody(md)).toBe(link)
    })

    it("links an address in text only: never inside a link's href or text, nor in code", () => {
        const ADDR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
        const html = renderMarkdown(`[${ADDR}](https://gno.land/u/${ADDR}) and \`${ADDR}\` then ${ADDR}`)
        const doc = new DOMParser().parseFromString(html, "text/html")
        const links = [...doc.querySelectorAll("a")]
        // The written link, whole, and one address link for the address in text: no link inside a link.
        expect(links.map((a) => a.getAttribute("href"))).toEqual([`https://gno.land/u/${ADDR}`, expect.stringMatching(new RegExp(`/profile/${ADDR}$`))])
        expect(links[0].textContent).toBe(ADDR)
        // On the raw HTML: a parser would repair a link nested in a link before any query saw it.
        expect(html.match(/<a\b/g)).toHaveLength(2)
        expect(doc.querySelector("code")!.textContent).toBe(ADDR)
        expect(doc.querySelector("code a")).toBeNull()
    })

    it("shows an image it does not load as a link to it, without a stray \"!\"", () => {
        const html = renderMarkdown("![diagram](https://example.org/d.png)\n\nsee ![](https://example.org/e.png) here")
        const doc = new DOMParser().parseFromString(html, "text/html")
        expect(doc.querySelector("img")).toBeNull()
        expect(doc.body.textContent).not.toContain("!")
        expect([...doc.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
            ["Image: diagram", "https://example.org/d.png"], ["Image", "https://example.org/e.png"],
        ])
    })
})

describe("renderPostBody (inline-only, untrusted feed posts)", () => {
    it("renders bold, italic, and inline code", () => {
        expect(renderPostBody("**b** *i* `c`")).toBe(
            '<strong>b</strong> <em>i</em> <code class="md-inline-code">c</code>',
        )
    })

    it("renders a safe markdown link (new tab, noopener)", () => {
        const h = renderPostBody("see [x](https://example.com)")
        expect(h).toContain('href="https://example.com"')
        expect(h).toContain('target="_blank"')
        expect(h).toContain('rel="noopener noreferrer"')
    })

    it("blocks a javascript: link (protocol whitelist)", () => {
        const h = renderPostBody("[x](javascript:alert(1))")
        expect(h).toContain('href="#"')
        expect(h).not.toContain("javascript:")
    })

    it("escapes raw HTML (no XSS)", () => {
        const h = renderPostBody('<img src=x onerror="alert(1)"> <script>alert(2)</script>')
        expect(h).not.toMatch(/<img|<script/)
        expect(h).toContain("&lt;img")
        expect(h).toContain("&lt;script&gt;")
    })

    it("does NOT render block markdown (headings/lists stay literal)", () => {
        expect(renderPostBody("# not a heading")).toBe("# not a heading")
        expect(renderPostBody("- not a list")).toBe("- not a list")
    })

    it("does NOT auto-link addresses in a post (v1)", () => {
        const h = renderPostBody("gm g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
        expect(h).not.toContain("/profile/")
        expect(h).not.toContain("<a")
    })

    it("returns empty for an empty body", () => {
        expect(renderPostBody("")).toBe("")
    })
})

describe("renderMarkdown — opt-in images", () => {
    it("renders a standalone image line as <img> ONLY when opted in", () => {
        const md = "intro\n\n![diagram](/blog/diagram.png)\n\noutro"
        const on = renderMarkdown(md, { images: true })
        expect(on).toContain('<img class="md-img" src="/blog/diagram.png" alt="diagram" loading="lazy" />')
        // Default (untrusted realm output) must NOT gain image rendering.
        const off = renderMarkdown(md)
        expect(off).not.toContain("<img")
    })

    it("rejects unsafe image protocols even when opted in", () => {
        const on = renderMarkdown("![x](javascript:alert(1))", { images: true })
        expect(on).not.toContain("<img")
        expect(on).not.toContain("javascript:")
        const data = renderMarkdown("![x](data:text/html;base64,AAA)", { images: true })
        expect(data).not.toContain("<img")
    })

    it("allows https and relative image sources", () => {
        expect(renderMarkdown("![a](https://x.test/i.png)", { images: true })).toContain('src="https://x.test/i.png"')
        expect(renderMarkdown("![a](/local/i.png)", { images: true })).toContain('src="/local/i.png"')
    })

    it("escapes the alt text", () => {
        const h = renderMarkdown('!["><script>x</script>](/i.png)', { images: true })
        expect(h).not.toContain("<script>")
        expect(h).toContain("&lt;script&gt;")
    })

    it("feed post bodies can never render an image (inline-only path)", () => {
        expect(renderPostBody("![x](https://x.test/i.png)")).not.toContain("<img")
    })
})
