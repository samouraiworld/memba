/**
 * Tests for markdownLite — lightweight markdown renderer.
 * Covers all supported elements + XSS safety.
 */
import { describe, it, expect } from "vitest"
import { renderMarkdown } from "./markdownLite"

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

    it("allows gno.land/ relative links", () => {
        const html = renderMarkdown("[dao](gno.land/r/gov/dao)")
        expect(html).toContain('href="gno.land/r/gov/dao"')
    })
})
