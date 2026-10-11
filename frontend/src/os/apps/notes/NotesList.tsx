import { useEffect, useRef, useState } from 'react'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { check, cursor, publicText, type ChainNote } from '../../../lib/notes/chain/schema'
import type { DraftRecord, NotesPartition, NotesStore } from '../../../lib/notes/drafts'
import { formatRelativeTime } from '../../../lib/blockTime'

type Client = Pick<NotesReadClient, 'byOwner'>
type State = 'Draft' | 'Public' | 'Private' | 'Unsaved'
type Row = { id: string; title: string; state: State; meta: string }
type Drafts = { items: DraftRecord[]; now: number; error: boolean }
type Published = { client: Client; owner: string; version: number; items: ChainNote[]; cursor: string; loading: boolean; error: boolean }
const PAGE_SIZE = 20

function chainTitle(note: ChainNote): string {
    if (note.mode < 3) return 'Private note'
    try { return publicText(note.title, true) } catch { return 'Untitled note' }
}
function rows({ items, now }: Drafts, published: ChainNote[], unsaved: ReadonlySet<string>, complete: boolean): Row[] {
    const onChain = new Map(published.map(note => [note.id, note]))
    // Most recent first; drafts saved in the same millisecond keep a stable order.
    const recent = [...items].sort((a, b) => b.updatedAt - a.updatedAt || (a.scope.noteId < b.scope.noteId ? -1 : 1))
    const local = recent.map((draft): Row => {
        const id = draft.scope.noteId, note = onChain.get(id), payload = draft.payload
        const title = payload.kind === 'public' ? payload.title.trim() : ''
        if (note) return { id, title: title || chainTitle(note), state: note.mode >= 3 ? 'Public' : 'Private', meta: `Revision ${note.stateRevision} · draft on this device` }
        if (payload.kind === 'encrypted') return { id, title: 'Private draft', state: 'Private', meta: 'On this device' }
        if (payload.base) return { id, title: title || 'Untitled note', state: 'Public', meta: `Revision ${payload.base.stateRevision} · draft on this device` }
        return { id, title: title || 'New note', state: 'Draft', meta: `On this device · ${formatRelativeTime(new Date(draft.updatedAt), now)}` }
    })
    const drafted = new Set(local.map(row => row.id))
    const all = [...local, ...published.filter(note => !drafted.has(note.id)).map((note): Row => ({ id: note.id, title: chainTitle(note), state: note.mode >= 3 ? 'Public' : 'Private', meta: `Revision ${note.stateRevision}` }))]
    // Unsent text on a note not listed here (a comment on someone else's note) stays one click away.
    const listed = new Set(all.map(row => row.id))
    const held = complete ? [...unsaved].filter(id => !listed.has(id)).map((id): Row => ({ id, title: 'Unsaved text', state: 'Unsaved', meta: 'A comment or edit not sent yet' })) : []
    return [...held, ...all.map(row => unsaved.has(row.id) ? { ...row, meta: `Unsaved changes · ${row.meta}` } : row)]
}

/** "My notes": local drafts first, then the account's notes from the chain index. Encrypted titles are never decoded here. */
export function NotesList({ store, partition, client, owner, query, selected, unsaved = [], refresh, onOpen }: {
    store: NotesStore; partition: NotesPartition; client: Client; owner: string | null
    query: string; selected: string | null; unsaved?: readonly string[]; refresh: number; onOpen(id: string): void
}) {
    const [drafts, setDrafts] = useState<Drafts>({ items: [], now: 0, error: false })
    const [reload, setReload] = useState(0)
    const [published, setPublished] = useState<Published | null>(null)
    const lifetime = useRef<AbortController | null>(null), busy = useRef(false)
    const { chainId, realm, owner: account } = partition
    useEffect(() => {
        let alive = true
        const load = () => void store.listDrafts({ chainId, realm, owner: account })
            .then(items => { if (alive) setDrafts({ items, now: Date.now(), error: false }) })
            .catch(() => { if (alive) setDrafts(value => ({ ...value, error: true })) })
        load(); window.addEventListener('focus', load)
        return () => { alive = false; window.removeEventListener('focus', load) }
    }, [store, chainId, realm, account, refresh])
    useEffect(() => {
        if (!owner) return
        const controller = new AbortController()
        lifetime.current = controller; busy.current = true
        void Promise.resolve().then(() => client.byOwner(owner, '', PAGE_SIZE)).then(page => {
            if (controller.signal.aborted) return
            check(page.items.length <= PAGE_SIZE && page.items.every(note => note.owner === owner && !note.deleted))
            setPublished({ client, owner, version: reload, items: page.items, cursor: cursor(page.nextCursor), loading: false, error: false })
        }).catch(() => {
            if (!controller.signal.aborted) setPublished({ client, owner, version: reload, items: [], cursor: '', loading: false, error: true })
        }).finally(() => { if (!controller.signal.aborted) busy.current = false })
        return () => controller.abort()
    }, [client, owner, reload])
    const current = owner && published?.client === client && published.owner === owner && published.version === reload ? published : null
    const chain = owner ? current ?? { items: [], cursor: '', loading: true, error: false } : { items: [], cursor: '', loading: false, error: false }
    async function more() {
        const controller = lifetime.current
        if (!owner || !current || !controller || controller.signal.aborted || busy.current || !current.cursor) return
        busy.current = true
        const previous = current.cursor
        setPublished(value => value && { ...value, loading: true, error: false })
        try {
            const page = await client.byOwner(owner, previous, PAGE_SIZE)
            if (controller.signal.aborted) return
            const next = cursor(page.nextCursor)
            // Realm indexes are traversed in descending sequence order.
            check(page.items.length <= PAGE_SIZE && page.items.every(note => note.owner === owner && !note.deleted) && (!next || next < previous))
            setPublished(value => {
                if (!value) return value
                const known = new Set(value.items.map(note => note.id))
                return { ...value, items: [...value.items, ...page.items.filter(note => !known.has(note.id))], cursor: next, loading: false, error: false }
            })
        } catch {
            if (!controller.signal.aborted) setPublished(value => value && { ...value, loading: false, error: true })
        } finally { if (!controller.signal.aborted) busy.current = false }
    }
    const needle = query.trim().toLocaleLowerCase()
    const all = rows(drafts, chain.items, new Set(unsaved), !chain.loading), shown = needle ? all.filter(row => row.title.toLocaleLowerCase().includes(needle)) : all
    return <>
        <ul className="os-notes-rows">{shown.map(row => <li key={row.id}>
            <button type="button" className="os-notes-row" aria-current={row.id === selected ? 'true' : undefined} onClick={() => onOpen(row.id)}>
                <span className="os-notes-row-title">{row.title}</span>
                <span className="os-notes-row-meta"><span className="os-notes-pill" data-state={row.state.toLowerCase()}>{row.state}</span>{row.meta}</span>
            </button>
        </li>)}</ul>
        {chain.loading && <p className="os-notes-list-note" role="status">Loading your published notes…</p>}
        {drafts.error && <p className="os-notes-list-note">Local drafts could not be read. Their stored copies were kept.</p>}
        {chain.error && <p className="os-notes-list-note">Your published notes could not be loaded. <button type="button" className="os-btn os-quiet" onClick={() => current?.cursor ? void more() : setReload(value => value + 1)}>Retry</button></p>}
        {!chain.loading && !chain.error && !shown.length && <p className="os-notes-list-note">{needle ? 'No notes match this search.' : 'No notes yet.'}</p>}
        {chain.cursor && !chain.error && <button type="button" className="os-btn os-quiet" disabled={chain.loading} onClick={() => void more()}>Show more notes</button>}
    </>
}
