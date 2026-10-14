import { useEffect, useState, type ReactNode } from "react"
import type { NotesReadClient } from "../../../lib/notes/chain/client"
import { publicText, type ChainNote } from "../../../lib/notes/chain/schema"
import { readFresh, useNoteRefresh } from "../../../lib/notes/freshness"
import { MarkdownPreview } from "./MarkdownPreview"
import { noteExportFilename } from "../../../lib/notes/exportFilename"
import { downloadMarkdown, shortAddress } from "./notesFormat"
import { NoteBanner, NoteHeader, NoteStatus, type NoteMenuItem, type NoteSlots } from "./NoteHeader"

type Client = Pick<NotesReadClient, "note"> & Partial<Pick<NotesReadClient, "chainId">>
type Read = { client: Client; id: string; version: number; phase: "loading" | "ready" | "error"; note: ChainNote | null }
/** Notes are never removed (deletion keeps a tombstone): an absent or older answer after a newer one is node lag. */
function newest(previous: Read, client: Client, id: string, note: ChainNote | null): ChainNote | null {
    const shown = previous.client === client && previous.id === id ? previous.note : null
    return shown && (!note || BigInt(note.stateRevision) < BigInt(shown.stateRevision)) ? shown : note
}
/** A skeleton while the note is read: never "Note not found" before a definitive answer. */
export function NoteSkeleton({ label = "Loading note…" }: { label?: string }) {
    return <section className="os-notes-document os-notes-skeleton" role="status" aria-busy="true">
        <span className="os-notes-sr">{label}</span>
        <i style={{ width: "34%" }} /><b style={{ width: "55%" }} /><i /><i style={{ width: "88%" }} /><i style={{ width: "72%" }} />
    </section>
}

type Props = {
    id: string; client: Client; owner: string | null
    /** The primary action (Edit) for this revision. */
    primary?(note: ChainNote): ReactNode
    /** Replaces the status line, e.g. when this device holds unpublished changes. */
    status?(note: ChainNote): ReactNode
    menu?(note: ChainNote): NoteMenuItem[]
    slots?(note: ChainNote, refresh: () => void, previewRoot: HTMLElement | null): NoteSlots
    banner?: ReactNode
    /** Legacy owner-only edit callback, used when no primary action is given. */
    onEdit?(note: ChainNote): void
    children?(note: ChainNote, refresh: () => void, previewRoot: HTMLElement | null): ReactNode
    encrypted?(note: ChainNote, refresh: () => void): ReactNode
}
export function PublicNote({ id, client, owner, primary, status, menu, slots, banner, onEdit, children, encrypted }: Props) {
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
    if (read.client !== client || read.id !== id || read.phase === "loading" || (refreshing && !read.note)) return <NoteSkeleton />
    if (read.phase === "error" && !read.note) return <section className="os-notes-welcome"><p role="alert">This note could not be read. Please try again.</p><button className="os-btn" onClick={() => bump()}>Retry</button></section>
    const note = read.note
    if (!note) return <section className="os-notes-welcome"><h1>Note not found</h1><p>No note was found at this address on the current network.</p></section>
    const refresh = () => bump(), root = note.deleted ? null : previewRoot
    const by = owner && note.actor === owner ? "you" : shortAddress(note.actor)
    const extra = slots?.(note, refresh, root)
    const failed = read.phase === "error" && <NoteBanner notice={{ tone: "warn", text: "The latest revision could not be read. The last loaded revision is still displayed.", actions: <button className="os-btn os-quiet" onClick={refresh}>Try again</button> }} />
    if (note.mode < 3) return encrypted?.(note, refresh) ?? <section className="os-notes-document os-notes-reader" aria-label="Private note">
        <NoteHeader noteId={id} status={<NoteStatus kind="private">Private · revision {note.stateRevision}</NoteStatus>} />
        <p className="os-notes-hint">This private note is encrypted. Opening private notes is not available in this version.</p>
    </section>
    if (note.deleted) return <section className="os-notes-document os-notes-reader" aria-label="Deleted note">
        <NoteHeader noteId={id} status={<NoteStatus kind="published">Deleted · revision {note.stateRevision} · by {by}</NoteStatus>} />
        {failed}
        <h1 className="os-notes-title">Deleted note</h1><p>The owner deleted this note. Earlier versions remain in chain history.</p>{children?.(note, refresh, null)}
    </section>
    const title = publicText(note.title, true), body = publicText(note.body!)
    const action = primary ? primary(note) : owner === note.owner && onEdit && <button className="os-btn" onClick={() => onEdit(structuredClone(note))}>Edit</button>
    return <section className="os-notes-document os-notes-reader" aria-label="Published note">
        <NoteHeader noteId={id} published slots={extra} primary={action}
            status={status?.(note) ?? <NoteStatus kind="published">Published · revision {note.stateRevision} · by {by}</NoteStatus>}
            menu={[{ label: "Export", hint: noteExportFilename(title), run: () => downloadMarkdown(title, body) }, ...menu?.(note) ?? []]} />
        {failed}{banner}
        <div className="os-notes-page" data-panel={extra?.panel ? "" : undefined}>
            <div className="os-notes-page-main">
                <h1 className="os-notes-title">{title}</h1>
                <p className="os-notes-hint">Everyone can read · {note.mode === 4 ? "everyone can comment" : "comments restricted to writers"}</p>
                <MarkdownPreview key={id} onRoot={setPreviewRoot} body={body} noteId={id} />
                {children?.(note, refresh, root)}
            </div>
            {extra?.panel && <aside className="os-notes-panel">{extra.panel}</aside>}
        </div>
    </section>
}
