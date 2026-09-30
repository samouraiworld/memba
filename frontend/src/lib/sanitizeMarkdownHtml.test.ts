import { describe, expect, it } from "vitest"
import DOMPurify from "dompurify"
import { renderMarkdown, renderPostBody } from "./markdownLite"
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

    it("treats protocol-relative, backslash and single-slash http links in raw HTML as external", () => {
        const html = sanitizeMarkdownHtml(['<a href="//evil.com">a</a>', '<a href="/\\evil.com">b</a>', '<a href="http:/evil.com">c</a>', '<a href="/&#x09;/evil.com">d</a>'].join(""))
        for (const link of links(html)) {
            expect(link.getAttribute("target"), link.textContent ?? "").toBe("_blank")
            expect(link.getAttribute("rel")).toBe("noopener noreferrer")
        }
    })

    it("keeps every element and attribute the renderers write", () => {
        const md = [
            "# One", "## Two", "### Three", "#### Four", "",
            "Plain **bold** *italic* ***both*** `code` [out](https://example.org/a?b=1&c=2) [in](/mainnet/dao) g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", "",
            "![diagram](https://example.org/diagram.png)", "",
            "```go", "func main() {}", "```", "",
            "---", "",
            "| A | B |", "|---|---|", "| 1 | **2** |", "",
            "- first", "- second", "",
            "1. one", "2. two",
        ].join("\n")
        // Links are compared without target and rel: the sanitizer decides those itself.
        const shape = (html: string) => Array.from(dom(html).querySelectorAll("*")).map((el) =>
            `${el.tagName}[${el.getAttributeNames().filter((name) => name !== "target" && name !== "rel").sort().map((name) => `${name}=${el.getAttribute(name)}`).join(" ")}]`)
        for (const html of [renderMarkdown(md, { images: true }), renderPostBody("**bold** *italic* `code` [out](https://example.org)")]) {
            const clean = sanitizeMarkdownHtml(html)
            expect(shape(clean)).toEqual(shape(html))
            expect(dom(clean).textContent).toBe(dom(html).textContent)
        }
        const tags = new Set(Array.from(dom(sanitizeMarkdownHtml(renderMarkdown(md, { images: true }))).querySelectorAll("*")).map((el) => el.tagName.toLowerCase()))
        for (const tag of ["h1", "h2", "h3", "h4", "p", "strong", "em", "code", "a", "img", "pre", "hr", "table", "thead", "tbody", "tr", "th", "td", "ul", "ol", "li"]) expect(tags, tag).toContain(tag)
    })

    it("drops every element and attribute the renderers never write", () => {
        const html = sanitizeMarkdownHtml([
            '<p id="x" style="position:fixed" aria-hidden="true" data-track="1" title="t" class="md-p">kept text</p>',
            '<form action="https://evil.example"><input name="seed"><button>Send</button></form>',
            '<svg><a href="https://evil.example"><text>svg</text></a></svg>',
            "<style>p{display:none}</style><div>div text</div><span>span text</span><h5>five</h5><details><summary>s</summary></details>",
            '<pre data-lang="go" data-other="1"><code>x</code></pre>',
        ].join(""))
        const root = dom(html)
        expect(Array.from(root.querySelectorAll("*")).map((el) => el.tagName.toLowerCase()).sort()).toEqual(["code", "p", "pre"])
        expect(root.querySelector("p")!.getAttributeNames()).toEqual(["class"])
        expect(root.querySelector("pre")!.getAttributeNames()).toEqual(["data-lang"])
        expect(html).not.toMatch(/style|form|input|svg|evil\.example/)
        // Text of an unwrapped container stays readable.
        expect(root.textContent).toContain("div text")
    })

    it("does not change the shared DOMPurify instance used elsewhere", () => {
        sanitizeMarkdownHtml('<a href="https://example.com">x</a>')
        const [a] = links(DOMPurify.sanitize('<a href="https://example.com" target="_blank">x</a>'))
        expect(a.hasAttribute("target")).toBe(false)
        expect(a.hasAttribute("rel")).toBe(false)
    })
})
