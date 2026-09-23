/**
 * sanitizeMarkdownHtml — DOMPurify for markdownLite output, with link targets.
 *
 * DOMPurify's default profile drops the `target` attribute, so the
 * `target="_blank"` that markdownLite writes on links never reached the page:
 * a link in an on-chain description opened in the app's own tab, replacing
 * the wallet session. This sanitizer runs on a DEDICATED DOMPurify instance so
 * its hook never affects the default instance other call sites use. After
 * sanitising attributes it:
 *   - opens absolute http(s) links in a new tab with rel="noopener noreferrer"
 *     (replacing any author-supplied target or rel);
 *   - removes `target` from every other link, so in-app links stay in the tab.
 * Dangerous URLs (javascript:, data:, vbscript:) are still removed by DOMPurify
 * itself before the hook runs.
 *
 * @module lib/sanitizeMarkdownHtml
 */
import DOMPurify from "dompurify"

const EXTERNAL = /^https?:\/\//i

let instance: ReturnType<typeof DOMPurify> | null = null

function purifier(): ReturnType<typeof DOMPurify> {
    if (instance) return instance
    const own = DOMPurify(window)
    own.addHook("afterSanitizeAttributes", (node) => {
        if (node.nodeName !== "A" && node.nodeName !== "AREA") return
        const el = node as Element
        el.removeAttribute("target")
        if (EXTERNAL.test((el.getAttribute("href") ?? "").trim())) {
            el.setAttribute("target", "_blank")
            el.setAttribute("rel", "noopener noreferrer")
        }
    })
    instance = own
    return own
}

/** Sanitise renderMarkdown()/renderPostBody() output before `dangerouslySetInnerHTML`. */
export function sanitizeMarkdownHtml(html: string): string {
    return purifier().sanitize(html)
}
