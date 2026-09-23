import { describe, expect, it } from "vitest"
import DOMPurify from "dompurify"
import { renderMarkdown } from "./markdownLite"
import { sanitizeMarkdownHtml } from "./sanitizeMarkdownHtml"

const dom = (html: string) => {
    const el = document.createElement("div")
    el.innerHTML = html
    return el
}
const links = (html: string) => Array.from(dom(html).querySelectorAll("a"))

describe("sanitizeMarkdownHtml", () => {
    it("opens external http(s) links in a new tab without opener or referrer", () => {
        const [a, b] = links(sanitizeMarkdownHtml(renderMarkdown("[docs](https://docs.gno.land/x) and [plain](http://example.com)")))
        for (const link of [a, b]) {
            expect(link.getAttribute("target")).toBe("_blank")
            expect(link.getAttribute("rel")).toBe("noopener noreferrer")
        }
        expect(a.getAttribute("href")).toBe("https://docs.gno.land/x")
    })

    it("keeps in-app links in the current tab", () => {
        const html = sanitizeMarkdownHtml(renderMarkdown("[home](/dao) [anchor](#top) g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"))
        for (const link of links(html)) expect(link.hasAttribute("target")).toBe(false)
    })

    it("strips javascript:, data: and vbscript: URLs, whatever their case or padding", () => {
        const payload = [
            '<a href="javascript:alert(1)" target="_self">x</a>',
            '<a href=" JaVaScRiPt:alert(1)">x</a>',
            '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
            '<a href="vbscript:msgbox(1)">x</a>',
            '<a href="java&#x09;script:alert(1)">x</a>',
        ].join("")
        const html = sanitizeMarkdownHtml(payload)
        for (const link of links(html)) {
            const href = link.getAttribute("href") ?? ""
            expect(href).not.toMatch(/script|data:/i)
            expect(link.hasAttribute("target")).toBe(false)
        }
        // Markdown links with hostile URLs never become live links either.
        const md = links(sanitizeMarkdownHtml(renderMarkdown("[x](javascript:alert(1)) [y](data:text/html,hi)")))
        for (const link of md) expect(link.getAttribute("href")).toBe("#")
    })

    it("overrides a hostile rel or target on an external link and drops event handlers and scripts", () => {
        const html = sanitizeMarkdownHtml('<a href="https://evil.example" rel="opener" target="_top" onclick="alert(1)">x</a><script>alert(1)</script><img src=x onerror="alert(1)">')
        const [a] = links(html)
        expect(a.getAttribute("rel")).toBe("noopener noreferrer")
        expect(a.getAttribute("target")).toBe("_blank")
        expect(html).not.toMatch(/onclick|onerror|<script/i)
    })

    it("does not change the shared DOMPurify instance used elsewhere", () => {
        sanitizeMarkdownHtml('<a href="https://example.com">x</a>')
        const [a] = links(DOMPurify.sanitize('<a href="https://example.com" target="_blank">x</a>'))
        expect(a.hasAttribute("target")).toBe(false)
        expect(a.hasAttribute("rel")).toBe(false)
    })
})
