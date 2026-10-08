import { Marked } from "marked"
import markedFootnote from "marked-footnote"
import { NOTES_MARKDOWN_LIMITS, type NotesRenderReply, type NotesRenderRequest } from "./renderProtocol"

const encoder = new TextEncoder()
const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
const parser = new Marked({ gfm: true, renderer: { html: ({ text }) => text.replace(/[&<>"']/g, char => escapes[char]) } }).use(markedFootnote())
const voidTags = new Set(["br", "hr", "img", "input"])

/** Call only in a terminable worker: hostile Markdown may exceed a parser's stack/time. */
export function parseNotesMarkdown(request: NotesRenderRequest): NotesRenderReply {
    const { id, markdown } = request
    if (typeof markdown !== "string" || encoder.encode(markdown).length > NOTES_MARKDOWN_LIMITS.inputBytes) return { id, status: "failed", reason: "input-limit" }
    try {
        const html = parser.parse(markdown, { async: false })
        if (encoder.encode(html).length > NOTES_MARKDOWN_LIMITS.outputBytes) return { id, status: "failed", reason: "output-limit" }
        let depth = 0, tags = 0
        // Raw author HTML was escaped. Bound the generated DOM before its sanitizer runs.
        for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi)) {
            if (++tags > NOTES_MARKDOWN_LIMITS.tags) return { id, status: "failed", reason: "tag-limit" }
            if (!voidTags.has(match[2].toLowerCase())) depth += match[1] ? -1 : 1
            if (depth > NOTES_MARKDOWN_LIMITS.depth) return { id, status: "failed", reason: "depth-limit" }
        }
        return { id, status: "parsed", html }
    } catch { return { id, status: "failed", reason: "parse-failed" } }
}
