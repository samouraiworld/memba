import { useEffect, useState, type ReactNode } from "react"
import type { NotesReadClient } from "../../../lib/notes/chain/client"
import { publicText, type ChainNote } from "../../../lib/notes/chain/schema"
import { readFresh, useNoteRefresh } from "../../../lib/notes/freshness"
import { MarkdownPreview } from "./MarkdownPreview"
import { noteExportFilename } from "../../../lib/notes/exportFilename"

type Client = Pick<NotesReadClient, "note"> & Partial<Pick<NotesReadClient, "chainId">>
type Read = { client: Client; id: string; version: number; phase: "loading" | "ready" | "error"; note: ChainNote | null }
/** Notes are never removed (deletion keeps a tombstone): an absent or older answer after a newer one is node lag. */
function newest(previous: Read, client: Client, id: string, note: ChainNote | null): ChainNote | null {
    const shown = previous.client === client && previous.id === id ? previous.note : null
    return shown && (!note || BigInt(note.stateRevision) < BigInt(shown.stateRevision)) ? shown : note
}

export function PublicNote({ id, client, owner, onEdit, editAction, children, encrypted }: { id: string; client: Client; owner: string | null; onEdit?(note: ChainNote): void; editAction?(note: ChainNote): ReactNode; children?(note: ChainNote, refresh: () => void, previewRoot: HTMLElement | null): ReactNode; encrypted?(note: ChainNote, refresh: () => void): ReactNode }) {
    const [read, setRead] = useState<Read>({ client, id, version: 0, phase: "loading", note: null })
    const [previewRoot, setPreviewRoot] = useState<HTMLElement | null>(null)
    // Confirmed changes and refocus re-read; an announced revision makes older answers count as node lag.
    const { tick: reload, minimum, bump } = useNoteRefresh(client.chainId ?? "", id)
    useEffect(() => {
        let alive = true
        void readFresh(() => client.note(id), note => note?.stateRevision ?? null, minimum(), () => alive)
            .then(note => { if (alive && note !== undefined) setRead(previous => ({ client, id, version: reload, phase: "ready", note: newest(previous, client, id, note) })) })
            .catch(() => { if (alive) setRead(previous => ({ client, id, version: reload, phase: "error", note: previous.client === client && previous.id === id ? previous.note : null })) })
        return () => { alive = false }
    }, [client, id, reload, minimum])
    const refreshing = read.version !== reload
    // An absent note is only reported once no newer read is pending: never flash "not found" while loading.
    if (read.client !== client || read.id !== id || read.phase === "loading" || (refreshing && !read.note)) return <section className="os-notes-welcome" role="status">Loading note…</section>
    if (read.phase === "error" && !read.note) return <section className="os-notes-welcome"><p role="alert">This note could not be read. Please try again.</p><button className="os-btn" onClick={() => bump()}>Retry</button></section>
    const note = read.note
    if (!note) return <section className="os-notes-welcome"><h1>Note not found</h1><p>No note was found at this address on the current network.</p></section>
    if (note.deleted) return <section className="os-notes-document os-notes-reader"><h1>Deleted note</h1><p>The owner deleted this note. Earlier versions remain in chain history.</p>{children?.(note, () => bump(), note.deleted ? null : previewRoot)}</section>
    if (note.mode < 3) return encrypted?.(note, () => bump()) ?? <section className="os-notes-welcome"><h1>Encrypted note</h1><p>Open the encryption settings to unlock your Notes identity.</p></section>
    const title = publicText(note.title, true), body = publicText(note.body!)
    function exportMarkdown() {
        const url = URL.createObjectURL(new Blob([`# ${title}\n\n${body}`], { type: "text/markdown;charset=utf-8" }))
        const link = document.createElement("a"); link.href = url; link.download = noteExportFilename(title); link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    return <section className="os-notes-document os-notes-reader" aria-label="Published note">
        <header className="os-notes-toolbar">
            <span role="status">On chain · Revision {note.stateRevision}</span>
            <button className="os-btn os-quiet" disabled={read.version !== reload} onClick={() => bump()}>{read.version !== reload ? 'Refreshing…' : 'Refresh'}</button>
            <button className="os-btn os-quiet" onClick={exportMarkdown}>Export Markdown</button>
            {editAction ? editAction(note) : owner === note.owner && onEdit && <button className="os-btn" onClick={() => onEdit(structuredClone(note))}>Edit note</button>}
        </header>
        {read.phase === 'error' && <p role="alert">Refresh failed. The last loaded revision is still displayed.</p>}
        <h1 className="os-notes-title">{title}</h1>
        <p className="os-notes-hint">Public note · {note.mode === 4 ? "Open comments" : "Restricted comments"} · Earlier versions remain in chain history</p>
        <MarkdownPreview key={id} onRoot={setPreviewRoot} body={body} noteId={id} />
        {children?.(note, () => bump(), note.deleted ? null : previewRoot)}
    </section>
}
