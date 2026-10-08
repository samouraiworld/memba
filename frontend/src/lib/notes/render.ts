import DOMPurify from "dompurify"
import { NOTES_MARKDOWN_LIMITS, type NotesRenderFailure, type NotesRenderReply, type NotesRenderResult } from "./renderProtocol"
export type { NotesRenderFailure, NotesRenderResult } from "./renderProtocol"

const allowedTags = ["a", "p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "code", "strong", "em", "del", "blockquote", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "sup", "section", "input", "hr", "br"]
const encoder = new TextEncoder()
let purifier: ReturnType<typeof DOMPurify> | undefined

/** No remote media, author HTML or arbitrary IDs. Every window owns its anchor namespace. */
export function sanitizeNotesHtml(html: string, scopeId: string): string {
    if (encoder.encode(html).length > NOTES_MARKDOWN_LIMITS.outputBytes || !/^[a-zA-Z0-9_-]{1,80}$/.test(scopeId)) throw new Error("This preview could not be displayed.")
    purifier ??= DOMPurify(window)
    const fragment = purifier.sanitize(html, {
        RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: ["href", "id", "type", "checked", "disabled", "aria-describedby", "aria-label"],
        ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    })
    const prefix = `note-${scopeId}-`
    const ids = new Map<string, string>()
    let count = 0
    for (const element of fragment.querySelectorAll("[id]")) {
        const original = element.id
        const replacement = `${prefix}ref-${++count}`
        if (!ids.has(original)) ids.set(original, replacement)
        element.id = replacement
    }
    for (const element of fragment.querySelectorAll("h1,h2,h3,h4,h5,h6")) if (!element.id) element.id = `${prefix}heading-${++count}`
    for (const element of fragment.querySelectorAll("a")) {
        const href = (element.getAttribute("href") ?? "").replace(/[\t\n\r]/g, "").trim()
        if (href.startsWith("#")) {
            const target = ids.get(href.slice(1))
            if (target) element.setAttribute("href", `#${target}`)
            else element.removeAttribute("href")
        } else if (/^https?:\/\//i.test(href)) {
            element.setAttribute("href", href)
            element.setAttribute("target", "_blank")
            element.setAttribute("rel", "noopener noreferrer")
        } else element.removeAttribute("href")
    }
    for (const element of fragment.querySelectorAll("[aria-describedby]")) {
        const target = ids.get(element.getAttribute("aria-describedby") ?? "")
        if (target) element.setAttribute("aria-describedby", target)
        else element.removeAttribute("aria-describedby")
    }
    for (const input of fragment.querySelectorAll("input")) { input.type = "checkbox"; input.disabled = true }
    const container = document.createElement("div")
    container.append(fragment)
    return container.innerHTML
}

export interface NotesRenderOptions { scopeId: string; signal?: AbortSignal }
export interface NotesRenderer {
    render(markdown: string, options: NotesRenderOptions): Promise<NotesRenderResult>
    dispose(): void
}
export interface NotesWorker {
    onmessage: ((event: MessageEvent<NotesRenderReply>) => void) | null
    onerror: ((event: ErrorEvent) => void) | null
    postMessage(message: { id: number; markdown: string }): void
    terminate(): void
}

/** Create one renderer per window. A new request cancels its predecessor. */
export function createNotesRenderer(options: { workerFactory?: () => NotesWorker; deadlineMs?: number } = {}): NotesRenderer {
    let sequence = 0, disposed = false
    let cancelActive: (() => void) | undefined
    const deadline = Math.max(1, Math.min(options.deadlineMs ?? 1000, 5000))
    const factory = options.workerFactory ?? (() => new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" }))
    const fallback = (markdown: string, reason: NotesRenderFailure): NotesRenderResult => {
        if (reason === "cancelled") return { kind: "text", reason, text: "", truncated: false }
        const bytes = encoder.encode(markdown)
        return { kind: "text", reason, text: new TextDecoder().decode(bytes.subarray(0, NOTES_MARKDOWN_LIMITS.inputBytes)), truncated: bytes.length > NOTES_MARKDOWN_LIMITS.inputBytes }
    }
    return {
        dispose() { disposed = true; cancelActive?.(); cancelActive = undefined },
        render(markdown, { scopeId, signal }) {
            const id = ++sequence
            cancelActive?.()
            if (disposed || signal?.aborted) return Promise.resolve(fallback(markdown, "cancelled"))
            if (encoder.encode(markdown).length > NOTES_MARKDOWN_LIMITS.inputBytes) return Promise.resolve(fallback(markdown, "input-limit"))
            if (!/^[a-zA-Z0-9_-]{1,80}$/.test(scopeId)) return Promise.resolve(fallback(markdown, "unavailable"))
            let worker: NotesWorker
            try { worker = factory() } catch { return Promise.resolve(fallback(markdown, "unavailable")) }
            return new Promise(resolve => {
                let settled = false
                const finish = (result: NotesRenderResult) => {
                    if (settled) return
                    settled = true; clearTimeout(timer); worker.terminate()
                    signal?.removeEventListener("abort", cancel)
                    if (cancelActive === cancel) cancelActive = undefined
                    resolve(result)
                }
                const cancel = () => finish(fallback(markdown, "cancelled"))
                const timer = setTimeout(() => finish(fallback(markdown, "timeout")), deadline)
                cancelActive = cancel
                signal?.addEventListener("abort", cancel, { once: true })
                worker.onerror = event => { event.preventDefault(); finish(fallback(markdown, "unavailable")) }
                worker.onmessage = ({ data }) => {
                    if (settled || data.id !== id || id !== sequence) return
                    if (data.status === "failed") { finish(fallback(markdown, data.reason)); return }
                    try { finish({ kind: "html", html: sanitizeNotesHtml(data.html, scopeId) }) }
                    catch { finish(fallback(markdown, "unavailable")) }
                }
                try { worker.postMessage({ id, markdown }) } catch { finish(fallback(markdown, "unavailable")) }
            })
        },
    }
}
