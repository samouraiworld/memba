import { useEffect, useRef, useState } from 'react'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { check, cursor, publicText, type NotesPage } from '../../../lib/notes/chain/schema'

type Client = Pick<NotesReadClient, 'byOwner' | 'sharedWith'>
type Source = 'owned' | 'shared'
type Row = { id: string; label: string; revision: string }
type Listing = { client: Client; owner: string; source: Source; version: number; rows: Row[]; cursor: string; loading: boolean; error: boolean }
const PAGE_SIZE = 20
function rows(page: NotesPage, owner: string, source: Source): Row[] {
    check(page.items.length <= PAGE_SIZE)
    return page.items.map(note => {
        check(!note.deleted && (source !== 'owned' || note.owner === owner))
        return { id: note.id, label: note.mode >= 3 ? publicText(note.title, true) : `Encrypted note · ${note.id.slice(0, 8)}`, revision: note.stateRevision }
    })
}

/** Discovery uses on-chain indexes only; encrypted titles are never decoded or retained. */
export function AccountLibrary({ client, owner, onOpen }: { client: Client; owner: string; onOpen(id: string): void }) {
    const [source, setSource] = useState<Source>('owned')
    const [reload, setReload] = useState(0)
    const [listing, setListing] = useState<Listing>({ client, owner, source, version: 0, rows: [], cursor: '', loading: true, error: false })
    const lifetime = useRef<AbortController | null>(null)
    const busy = useRef(false)
    useEffect(() => {
        const controller = new AbortController()
        lifetime.current = controller; busy.current = true
        const query = source === 'owned' ? client.byOwner.bind(client) : client.sharedWith.bind(client)
        void Promise.resolve().then(() => query(owner, '', PAGE_SIZE)).then(page => {
            if (controller.signal.aborted) return
            setListing({ client, owner, source, version: reload, rows: rows(page, owner, source), cursor: cursor(page.nextCursor), loading: false, error: false })
        }).catch(() => {
            if (!controller.signal.aborted) setListing({ client, owner, source, version: reload, rows: [], cursor: '', loading: false, error: true })
        }).finally(() => { if (!controller.signal.aborted) busy.current = false })
        return () => controller.abort()
    }, [client, owner, source, reload])
    const matches = listing.client === client && listing.owner === owner && listing.source === source && listing.version === reload
    const visible = matches ? listing : { rows: [], cursor: '', loading: true, error: false }
    async function more() {
        const controller = lifetime.current
        if (!controller || controller.signal.aborted || busy.current || !matches || !listing.cursor) return
        busy.current = true
        const previous = listing.cursor
        setListing(value => ({ ...value, loading: true, error: false }))
        try {
            const page = await (source === 'owned' ? client.byOwner(owner, previous, PAGE_SIZE) : client.sharedWith(owner, previous, PAGE_SIZE))
            if (controller.signal.aborted) return
            const next = cursor(page.nextCursor), additions = rows(page, owner, source)
            // Realm indexes are traversed in descending sequence order.
            check(!next || next < previous)
            setListing(value => {
                const known = new Set(value.rows.map(row => row.id))
                return { ...value, rows: [...value.rows, ...additions.filter(row => !known.has(row.id))], cursor: next, loading: false, error: false }
            })
        } catch {
            if (!controller.signal.aborted) setListing(value => ({ ...value, loading: false, error: true }))
        } finally { if (!controller.signal.aborted) busy.current = false }
    }
    return <section className="os-notes-library" aria-label="Account notes">
        <header><h2>Your published notes</h2><button className="os-btn os-quiet" disabled={visible.loading} onClick={() => setReload(value => value + 1)}>Refresh account notes</button></header>
        <p className="os-sub">From the chain · Encrypted titles stay hidden until opened</p>
        <div role="group" aria-label="Account note lists">
            <button className="os-btn" aria-pressed={source === 'owned'} onClick={() => setSource('owned')}>Owned</button>
            <button className="os-btn" aria-pressed={source === 'shared'} onClick={() => setSource('shared')}>Shared with you</button>
        </div>
        <ul>{visible.rows.map(row => <li key={row.id}><button onClick={() => onOpen(row.id)}><span>{row.label}</span><small>Revision {row.revision}</small></button></li>)}</ul>
        {visible.loading && <p role="status">Loading account notes…</p>}
        {visible.error && <div role="alert"><p>Account notes could not be loaded. Please try again.</p><button className="os-btn" onClick={() => visible.cursor ? void more() : setReload(value => value + 1)}>Retry account notes</button></div>}
        {!visible.loading && !visible.error && !visible.rows.length && <p className="os-sub">{source === 'owned' ? 'No published notes owned by this account.' : 'No notes are currently shared with this account.'}</p>}
        {visible.cursor && !visible.error && <button className="os-btn" disabled={visible.loading} onClick={() => void more()}>Load more account notes</button>}
    </section>
}
