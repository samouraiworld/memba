import { afterEach, describe, expect, it, vi } from "vitest"
import { createNotesRenderer, sanitizeNotesHtml, type NotesWorker } from "./render"
import { parseNotesMarkdown } from "./renderWorker"
import type { NotesRenderReply } from "./renderProtocol"

class FakeWorker implements NotesWorker {
    onmessage: ((event: MessageEvent<NotesRenderReply>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage = vi.fn<(message: { id: number; markdown: string }) => void>()
    terminate = vi.fn()
    reply(value: NotesRenderReply) { this.onmessage?.({ data: value } as MessageEvent<NotesRenderReply>) }
}
afterEach(() => vi.useRealTimers())
const opts = { scopeId: "fixture-window1" }
const fixture = "# Sushi\n\n> Keep cool\n\n- [x] Rice\n\n|a|b|\n|-|-|\n|1|2|\n\n~~Old~~ text[^1]\n\n[^1]: Footnote\n\n![remote](https://example.invalid/image.png)"

describe("Notes rendering", () => {
    it("parses required GFM and keeps note-scoped footnotes reachable after sanitizing", () => {
        const parsed = parseNotesMarkdown({ id: 1, markdown: fixture })
        expect(parsed.status).toBe("parsed")
        if (parsed.status !== "parsed") return
        const root = document.createElement("div"); root.innerHTML = sanitizeNotesHtml(parsed.html, opts.scopeId)
        for (const selector of ["h1", "blockquote", "table", "del", "sup", 'input[type="checkbox"][disabled]']) expect(root.querySelector(selector)).not.toBeNull()
        expect(root.querySelector("img")).toBeNull()
        const ids = new Set([...root.querySelectorAll("[id]")].map(element => element.id))
        expect([...ids].every(id => id.startsWith("note-fixture-window1-"))).toBe(true)
        for (const link of root.querySelectorAll('a[href^="#"]')) expect(ids.has(link.getAttribute("href")!.slice(1))).toBe(true)
        for (const element of root.querySelectorAll("[aria-describedby]")) expect(ids.has(element.getAttribute("aria-describedby")!)).toBe(true)
        expect(sanitizeNotesHtml(parsed.html, "fixture-window2")).not.toContain('id="note-fixture-window1-')
    })
    it("escapes raw HTML and strips executable elements, remote images and unsafe protocols", () => {
        const attacks = ['<script>alert(1)</script>', '<svg onload="alert(1)"></svg>', '<img src=x onerror=alert(1)>', '<form id=preview name=location>x</form>', '[x](javascript:alert(1))', '[x](data:text/html,x)', '[x](vbscript:evil)', '[x](//example.invalid)', '[x](https://example.invalid)']
        const parsed = parseNotesMarkdown({ id: 1, markdown: attacks.join("\n\n") })
        expect(parsed.status).toBe("parsed"); if (parsed.status !== "parsed") return
        const root = document.createElement("div"); root.innerHTML = sanitizeNotesHtml(parsed.html, "safe")
        expect(root.querySelector("svg,script,img,form,[onload],[onerror],[name]")).toBeNull()
        for (const link of root.querySelectorAll("a[href]")) expect(link.getAttribute("href")).toMatch(/^https:\/\//)
        expect(root.querySelector("a[href]")?.getAttribute("rel")).toBe("noopener noreferrer")
        // Defense in depth also sanitizes a worker reply that did not come from our parser.
        expect(sanitizeNotesHtml('<iframe src=x></iframe><a href="javascript:x" id="__proto__">x</a>', "safe")).not.toMatch(/iframe|javascript:|__proto__/)
    })
    it("bounds UTF-8 input, parser output, tag counts and DOM depth", () => {
        expect(parseNotesMarkdown({ id: 1, markdown: "a".repeat(131072) }).status).toBe("parsed")
        expect(parseNotesMarkdown({ id: 1, markdown: "😀".repeat(32769) })).toMatchObject({ reason: "input-limit" })
        expect(parseNotesMarkdown({ id: 1, markdown: "&".repeat(131072) })).toMatchObject({ reason: "output-limit" })
        expect(parseNotesMarkdown({ id: 1, markdown: "- a\n".repeat(7000) })).toMatchObject({ reason: "tag-limit" })
        expect(parseNotesMarkdown({ id: 1, markdown: "> ".repeat(65) + "deep" })).toMatchObject({ reason: "depth-limit" })
        expect(() => sanitizeNotesHtml("a".repeat(524289), "safe")).toThrow()
    })
    it("terminates a worker that exceeds its deadline and returns accessible text", async () => {
        vi.useFakeTimers()
        const worker = new FakeWorker(), renderer = createNotesRenderer({ workerFactory: () => worker, deadlineMs: 50 })
        const pending = renderer.render("# Kept as text", opts)
        await vi.advanceTimersByTimeAsync(50)
        expect(await pending).toEqual({ kind: "text", text: "# Kept as text", reason: "timeout", truncated: false })
        expect(worker.terminate).toHaveBeenCalledOnce()
    })
    it("cancels superseded requests and never installs a late worker result", async () => {
        const a = new FakeWorker(), b = new FakeWorker(), workers = [a, b]
        const renderer = createNotesRenderer({ workerFactory: () => workers.shift()! })
        const old = renderer.render("old", opts), current = renderer.render("new", opts)
        expect(await old).toMatchObject({ kind: "text", reason: "cancelled" })
        a.reply({ id: 1, status: "parsed", html: "<p>old</p>" })
        b.reply({ id: 2, status: "parsed", html: "<p>new</p>" })
        expect(await current).toEqual({ kind: "html", html: "<p>new</p>" })
        expect(a.terminate).toHaveBeenCalledOnce(); expect(b.terminate).toHaveBeenCalledOnce()
    })
    it("aborts a pending preview on lock and disposes without accepting more work", async () => {
        const worker = new FakeWorker(), renderer = createNotesRenderer({ workerFactory: () => worker }), controller = new AbortController()
        const pending = renderer.render("private draft", { ...opts, signal: controller.signal })
        controller.abort()
        expect(await pending).toMatchObject({ kind: "text", reason: "cancelled" })
        expect(worker.terminate).toHaveBeenCalledOnce()
        renderer.dispose()
        expect(await renderer.render("x", opts)).toMatchObject({ reason: "cancelled" })
    })
    it("returns bounded text when workers are unavailable and never starts oversized input", async () => {
        const factory = vi.fn(() => { throw new Error("blocked by policy") }), renderer = createNotesRenderer({ workerFactory: factory })
        expect(await renderer.render("text", opts)).toMatchObject({ kind: "text", reason: "unavailable", text: "text" })
        factory.mockClear()
        const out = await renderer.render("a".repeat(131073), opts)
        expect(out).toMatchObject({ reason: "input-limit", truncated: true })
        if (out.kind === "text") expect(out.text).toHaveLength(131072)
        expect(factory).not.toHaveBeenCalled()
    })
})
