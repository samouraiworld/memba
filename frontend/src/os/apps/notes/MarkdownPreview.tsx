import { useEffect, useId, useState } from "react"
import { createNotesRenderer, type NotesRenderResult } from "../../../lib/notes/render"

/** The shared bounded Worker renderer. No remote images or raw Markdown HTML. */
export function MarkdownPreview({ body, noteId, onRoot }: { body: string; noteId: string; onRoot?(root: HTMLElement | null): void }) {
    const [rendered, setRendered] = useState<{ body: string; noteId: string; result: NotesRenderResult } | null>(null)
    const windowId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
    const result = rendered?.body === body && rendered.noteId === noteId ? rendered.result : null
    useEffect(() => {
        const controller = new AbortController()
        const renderer = createNotesRenderer()
        const timer = setTimeout(() => {
            void renderer.render(body, { scopeId: `${noteId}-${windowId}`, signal: controller.signal }).then(next => {
                if (!controller.signal.aborted) setRendered({ body, noteId, result: next })
            })
        }, 180)
        return () => { clearTimeout(timer); controller.abort(); renderer.dispose() }
    }, [body, noteId, windowId])
    return <article ref={onRoot} data-rendered={result?.kind ?? "loading"} className="os-notes-preview" aria-label="Note preview" onClick={event => {
        const anchor = (event.target as Element).closest("a")
        const href = anchor?.getAttribute("href")
        if (href?.startsWith("#")) {
            event.preventDefault()
            const target = Array.from(event.currentTarget.querySelectorAll("[id]")).find(node => node.id === href.slice(1))
            target?.scrollIntoView({ block: "nearest" })
        }
    }}>{result?.kind === "html" ? <div dangerouslySetInnerHTML={{ __html: result.html }} /> : <pre>{result?.kind === "text" ? result.text : body}</pre>}</article>
}
