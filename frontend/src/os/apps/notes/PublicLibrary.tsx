import { useEffect, useRef, useState } from "react"
import type { NotesReadClient } from "../../../lib/notes/chain/client"
import { publicText, type ChainNote } from "../../../lib/notes/chain/schema"

type Client = Pick<NotesReadClient, "publicNotes">
type Listing = { client: Client; version: number; items: ChainNote[]; cursor: string; loading: boolean; error: boolean }
const PAGE_SIZE = 20

export function PublicLibrary({ client, onOpen }: { client: Client; onOpen(id: string): void }) {
    const [listing, setListing] = useState<Listing>({ client, version: 0, items: [], cursor: "", loading: true, error: false })
    const [reload, setReload] = useState(0)
    const lifetime = useRef<AbortController | null>(null)
    const busy = useRef(false)
    const cursors = useRef(new Set<string>())
    useEffect(() => {
        const controller = new AbortController()
        lifetime.current = controller
        busy.current = true
        cursors.current.clear()
        void client.publicNotes("", PAGE_SIZE).then(page => {
            if (controller.signal.aborted) return
            setListing({ client, version: reload, items: page.items, cursor: page.nextCursor, loading: false, error: false })
        }).catch(() => {
            if (!controller.signal.aborted) setListing({ client, version: reload, items: [], cursor: "", loading: false, error: true })
        }).finally(() => { if (!controller.signal.aborted) busy.current = false })
        return () => controller.abort()
    }, [client, reload])
    async function more() {
        const controller = lifetime.current
        if (!controller || controller.signal.aborted || busy.current || listing.client !== client || listing.version !== reload || !listing.cursor) return
        busy.current = true
        const cursor = listing.cursor
        setListing(current => ({ ...current, loading: true, error: false }))
        try {
            const page = await client.publicNotes(cursor, PAGE_SIZE)
            if (controller.signal.aborted) return
            if (page.nextCursor && (page.nextCursor === cursor || cursors.current.has(page.nextCursor))) throw new Error("Invalid page progression")
            cursors.current.add(cursor)
            setListing(current => {
                const known = new Set(current.items.map(note => note.id))
                return { client, version: reload, items: [...current.items, ...page.items.filter(note => !known.has(note.id))], cursor: page.nextCursor, loading: false, error: false }
            })
        } catch {
            if (!controller.signal.aborted) setListing(current => ({ ...current, loading: false, error: true }))
        } finally { if (!controller.signal.aborted) busy.current = false }
    }
    const visible = listing.client === client && listing.version === reload ? listing : { items: [], cursor: "", loading: true, error: false }
    return <section className="os-notes-library" aria-label="Public notes">
        <header><h2>Public notes</h2><button className="os-btn os-quiet" disabled={visible.loading} onClick={() => setReload(value => value + 1)}>Refresh</button></header>
        <p className="os-sub">Published on chain · Read without connecting</p>
        <ul>{visible.items.map(note => <li key={note.id}><button onClick={() => onOpen(note.id)}>
            <span>{publicText(note.title, true)}</span><small>Revision {note.stateRevision}</small>
        </button></li>)}</ul>
        {visible.loading && <p role="status">Loading public notes…</p>}
        {visible.error && <div role="alert"><p>Public notes could not be loaded. Please try again.</p>
            <button className="os-btn" onClick={() => visible.cursor ? void more() : setReload(value => value + 1)}>Retry</button></div>}
        {!visible.loading && !visible.error && !visible.items.length && <p className="os-sub">No public notes have been listed yet.</p>}
        {visible.cursor && !visible.error && <button className="os-btn" disabled={visible.loading} onClick={() => void more()}>Load more</button>}
    </section>
}
