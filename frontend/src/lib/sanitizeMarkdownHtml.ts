/**
 * sanitizeMarkdownHtml — DOMPurify for markdownLite output, with link targets.
 *
 * DOMPurify's default profile drops the `target` attribute, so the
 * `target="_blank"` that markdownLite writes on links never reached the page:
 * a link in an on-chain description opened in the app's own tab, replacing
 * the wallet session. This sanitizer runs on a DEDICATED DOMPurify instance so
 * its hook never affects the default instance other call sites use. After
 * sanitising attributes it:
 *   - opens http(s) and protocol-relative ("//host", "/\\host") links in a new
 *     tab with rel="noopener noreferrer" (replacing any author target or rel);
 *   - removes `target` from every other link, so in-app links stay in the tab.
 * Dangerous URLs (javascript:, data:, vbscript:) are still removed by DOMPurify
 * itself before the hook runs.
 *
 * @module lib/sanitizeMarkdownHtml
 */
import DOMPurify from "dompurify"

/**
 * Leaves the app: an http(s) scheme (browsers also read "http:/host" as a host)
 * or a protocol-relative "//host", including backslash forms browsers treat alike.
 */
const EXTERNAL = /^(?:https?:|[/\\]{2})/i

/** How a browser reads an href: tabs and line breaks removed, outer spaces trimmed. */
const normaliseHref = (href: string) => href.replace(/[\t\n\r]/g, "").trim()

/**
 * Everything markdownLite's renderers write, and nothing more: DOMPurify's default profile
 * also lets through style, id, form controls and SVG, none of which they produce.
 * `target` and `rel` are not listed: the hook below sets them itself.
 */
const ALLOWED_TAGS = ["a", "code", "em", "strong", "img", "pre", "hr", "h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td"]
const ALLOWED_ATTR = ["href", "class", "src", "alt", "loading", "data-lang"]

let instance: ReturnType<typeof DOMPurify> | null = null

function purifier(): ReturnType<typeof DOMPurify> {
    if (instance) return instance
    const own = DOMPurify(window)
    own.addHook("afterSanitizeAttributes", (node) => {
        if (node.nodeName !== "A") return
        const el = node as Element
        el.removeAttribute("target")
        if (EXTERNAL.test(normaliseHref(el.getAttribute("href") ?? ""))) {
            el.setAttribute("target", "_blank")
            el.setAttribute("rel", "noopener noreferrer")
        }
    })
    instance = own
    return own
}

/** Sanitise renderMarkdown()/renderPostBody() output before `dangerouslySetInnerHTML`. */
export function sanitizeMarkdownHtml(html: string): string {
    return purifier().sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false })
}
