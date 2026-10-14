import { useEffect, useRef, useState } from 'react'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { check, cursor, publicText, type ChainNote } from '../../../lib/notes/chain/schema'
import type { DraftRecord, NotesPartition, NotesStore } from '../../../lib/notes/drafts'
import { formatRelativeTime } from '../../../lib/blockTime'
import { onNoteChange, onNotesFocus } from '../../../lib/notes/freshness'
import { trimPublicTitle } from '../../../lib/notes/publicFields'

/**
 * The published note behind a local draft: `noteMetadata` gives its current revision and whether it is deleted (no body);
 * `note` gives its text, read only to compare a draft that follows that same revision.
 */
type Client = Pick<NotesReadClient, 'byOwner'> & Partial<Pick<NotesReadClient, 'note' | 'noteMetadata'>>
type Text = { title: string; body: string }
const textKey = (id: string, revision: string) => `${id}:${revision}`
type State = 'Draft' | 'Public' | 'Private' | 'Unsaved' | 'Deleted'
type Row = { id: string; title: string; state: State; meta: string }
type Drafts = { items: DraftRecord[]; now: number; error: boolean }
type Published = { client: Client; owner: string; version: number; items: ChainNote[]; cursor: string; loading: boolean; error: boolean }
const PAGE_SIZE = 20

function chainTitle(note: ChainNote): string {
    if (note.mode < 3) return 'Private note'
    try { return publicText(note.title, true) } catch { return 'Untitled note' }
}
/** The draft's text is the published text at the revision it follows: nothing of it is unpublished (F8). */
function clean(payload: DraftRecord['payload'], note: ChainNote, text: Text | undefined): boolean {
    if (payload.kind !== 'public' || !payload.base || payload.base.stateRevision !== note.stateRevision || note.mode < 3 || !text) return false
    return trimPublicTitle(payload.title) === text.title && payload.body === text.body
}
/** A read never moves a row back: a lagging node can answer with an older revision than one already shown. */
function newer(known: ReadonlyMap<string, ChainNote>, note: ChainNote): ReadonlyMap<string, ChainNote> {
    const shown = known.get(note.id)
    return shown && BigInt(shown.stateRevision) > BigInt(note.stateRevision) ? known : new Map(known).set(note.id, note)
}
/** An untouched blank draft (first open, New note): listed only while it is the note on screen (F12). */
const blank = (draft: DraftRecord) => draft.payload.kind === 'public' && !draft.payload.title && !draft.payload.body && !draft.payload.base
function rows({ items, now }: Drafts, published: ChainNote[], unsaved: ReadonlySet<string>, complete: boolean, fresh: ReadonlyMap<string, ChainNote>, texts: ReadonlyMap<string, Text>, selected: string | null): Row[] {
    const onChain = new Map(published.map(note => [note.id, note]))
    // Most recent first; drafts saved in the same millisecond keep a stable order.
    const recent = [...items].sort((a, b) => b.updatedAt - a.updatedAt || (a.scope.noteId < b.scope.noteId ? -1 : 1))
    const local = recent.filter(draft => !blank(draft) || draft.scope.noteId === selected || unsaved.has(draft.scope.noteId)).map((draft): Row => {
        const id = draft.scope.noteId, read = fresh.get(id), payload = draft.payload
        // A fresh read of the note behind the draft wins over the index page: it follows announced changes (F18).
        const note = read ?? onChain.get(id)
        const title = payload.kind === 'public' ? payload.title.trim() : ''
        // Only a recorded deletion says Deleted: an absent answer is a lagging node (notes are never removed).
        if (read?.deleted) return { id, title: title || 'Deleted note', state: 'Deleted', meta: 'Draft on this device · open it to remove it' }
        if (note && clean(payload, note, texts.get(textKey(id, note.stateRevision)))) return { id, title: title || chainTitle(note), state: 'Public', meta: `Revision ${note.stateRevision}` }
        if (note) return { id, title: title || chainTitle(note), state: note.mode >= 3 ? 'Public' : 'Private', meta: `Revision ${note.stateRevision} · draft on this device` }
        if (payload.kind === 'encrypted') return { id, title: 'Private draft', state: 'Private', meta: 'On this device' }
        if (payload.base) return { id, title: title || 'Untitled note', state: 'Public', meta: `Revision ${payload.base.stateRevision} · draft on this device` }
        return { id, title: title || 'New note', state: 'Draft', meta: `On this device · ${formatRelativeTime(new Date(draft.updatedAt), now)}` }
    })
    const drafted = new Set(local.map(row => row.id))
    const all = [...local, ...published.filter(note => !drafted.has(note.id)).map((note): Row => {
        const read = fresh.get(note.id), shown = read && !read.deleted && BigInt(read.stateRevision) > BigInt(note.stateRevision) ? read : note
        return { id: note.id, title: chainTitle(shown), state: shown.mode >= 3 ? 'Public' : 'Private', meta: `Revision ${shown.stateRevision}` }
    })]
    // Unsent text on a note not listed here (a comment on someone else's note) stays one click away.
    const listed = new Set(all.map(row => row.id))
    // Named after its note once the note's metadata is read (a private note stays "Private note"; nothing is decoded).
    const held = complete ? [...unsaved].filter(id => !listed.has(id)).map((id): Row => { const note = fresh.get(id)
        return note && !note.deleted ? { id, title: chainTitle(note), state: 'Unsaved', meta: 'Not sent yet' } : { id, title: 'Unsaved text', state: 'Unsaved', meta: 'A comment or edit not sent yet' } }) : []
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
    /** Metadata of the published notes behind local drafts, and of any note a change was announced for (id → note). */
    const [fresh, setFresh] = useState<ReadonlyMap<string, ChainNote>>(new Map())
    /** Published text at a revision a draft follows, read once per (note, revision): `${id}:${revision}` → text. */
    const [texts, setTexts] = useState<ReadonlyMap<string, Text>>(new Map())
    /** What was already asked of this client: drafts reload on every autosave and focus, the reads do not repeat. */
    const asked = useRef({ client: null as Client | null, meta: new Set<string>(), text: new Set<string>() })
    const [focused, setFocused] = useState(0)
    const mounted = useRef(false)
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
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
    const heldIds = unsaved.join(',')
    // The note behind each draft that follows a published revision, behind unsent text, and every note a change is announced for on this network.
    useEffect(() => {
        if (asked.current.client !== client) asked.current = { client, meta: new Set(), text: new Set() }
        const meta = client.noteMetadata?.bind(client)
        if (!meta) return
        const read = (id: string) => void Promise.resolve().then(() => meta(id)).then(note => {
            // An absent answer or a failed read keeps what was shown: it never proves deletion.
            if (mounted.current && asked.current.client === client && note && note.id === id) setFresh(value => newer(value, note))
        }).catch(() => {})
        for (const draft of drafts.items) {
            const id = draft.scope.noteId
            if (draft.payload.kind === 'public' && draft.payload.base && !asked.current.meta.has(id)) { asked.current.meta.add(id); read(id) }
        }
        // Unsent text on a note without a draft here (a comment on someone else's note): its row is named after the note.
        for (const id of heldIds ? heldIds.split(',') : []) if (!drafts.items.some(draft => draft.scope.noteId === id) && !asked.current.meta.has(id)) { asked.current.meta.add(id); read(id) }
    }, [drafts.items, client, heldIds, focused])
    // Bringing Notes to the front reads those notes again (another device or window may have changed them).
    useEffect(() => onNotesFocus(chainId, () => { asked.current.meta.clear(); setFocused(value => value + 1) }), [chainId])
    useEffect(() => {
        const meta = client.noteMetadata?.bind(client)
        if (!meta) return
        return onNoteChange(change => {
            if (change.chainId !== chainId) return
            void Promise.resolve().then(() => meta(change.noteId)).then(note => {
                if (mounted.current && note && note.id === change.noteId) setFresh(value => newer(value, note))
            }).catch(() => {})
        })
    }, [chainId, client])
    // The body only when a draft follows the published revision, once per (note, revision).
    useEffect(() => {
        const full = client.note?.bind(client)
        if (!full || asked.current.client !== client) return
        for (const draft of drafts.items) {
            const id = draft.scope.noteId, note = fresh.get(id), base = draft.payload.kind === 'public' ? draft.payload.base : undefined
            if (!note || note.deleted || note.mode < 3 || !base || base.stateRevision !== note.stateRevision) continue
            const key = textKey(id, note.stateRevision)
            if (asked.current.text.has(key)) continue
            asked.current.text.add(key)
            void Promise.resolve().then(() => full(id)).then(read => {
                if (!mounted.current || !read || read.id !== id || read.stateRevision !== note.stateRevision || !read.body) return
                const text = { title: publicText(read.title, true), body: publicText(read.body) }
                setTexts(value => new Map(value).set(key, text))
            }).catch(() => {})
        }
    }, [drafts.items, fresh, client])
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
    const all = rows(drafts, chain.items, new Set(unsaved), !chain.loading, fresh, texts, selected), shown = needle ? all.filter(row => row.title.toLocaleLowerCase().includes(needle)) : all
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
