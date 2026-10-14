import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { NativeViewProps } from '../../native/types'
import { createDraftSession, createNotesStore, type NotesPartition } from '../../../lib/notes/drafts'
import { NOTE_ID, NOTES_ENABLED, notesDeployment } from '../../../lib/notes/config'
import { NotesReadClient } from '../../../lib/notes/chain/client'
import { getRpcUrlsInOrder } from '../../../lib/rpcFallback'
import { PublicLibrary } from './PublicLibrary'
import { PublicNote } from './PublicNote'
import { PublicCommentPanel } from './PublicCommentPanel'
import { PublicAuthoring } from './PublicAuthoring'
import { PublicOperationStatus } from './PublicOperationStatus'
import { PublicHistory } from './PublicHistory'
import { DraftEditor } from './DraftEditor'
import { NotesList } from './NotesList'
import { clearLastNote, openBlankDraft, readLastNote, writeLastNote } from './notesWorkspace'
import { NotesPaneContext, PUBLISHING, type NotesPane } from './notesPane'
import './notes-public.css'
import './notes-workspace.css'

const store = createNotesStore()
type Props = Pick<NativeViewProps, 'session' | 'section' | 'fallback'> & { onOpenNote(id: string): void; onShowList(): void; active?: boolean }

/** Dormant public reader. The shell owns registration, navigation and stable mounting. */
export function PublicNotesApp(props: Props) {
    if (!NOTES_ENABLED) return props.fallback
    const owner = props.session.status === 'member' ? props.session.address || null : null
    // One window per account and network: the shown note is state of this workspace, not its identity.
    return <PublicWorkspace key={JSON.stringify([props.session.network.chainId, owner, notesDeployment(props.session.network.chainId)])} {...props} owner={owner} />
}
function PublicWorkspace({ session, section, owner, onOpenNote, onShowList, active = false }: Props & { owner: string | null }) {
    const chainId = session.network.chainId
    const [read, setRead] = useState<{ client: NotesReadClient | null; error: boolean }>({ client: null, error: false })
    const [attempt, retry] = useState(0)
    const deployment = notesDeployment(chainId)
    useLayoutEffect(() => {
        if (!deployment) return
        const lifetime = new AbortController()
        try {
            const client = new NotesReadClient({ chainId, deployment, rpcUrls: getRpcUrlsInOrder(), isCurrent: () => !lifetime.signal.aborted })
            // The client belongs to this effect lifetime, including StrictMode remounts.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setRead({ client, error: false })
        } catch { setRead({ client: null, error: true }) }
        return () => lifetime.abort()
    }, [chainId, deployment, attempt])
    // Stable identities: effects keyed on scope must not re-run on unrelated parent renders.
    const realm = deployment?.realm ?? null, noteId = section !== null && NOTE_ID.test(section) ? section : null
    const partition = useMemo(() => realm ? { chainId, realm, owner: owner ?? 'guest' } : null, [chainId, realm, owner])
    // The note in the address, else the one this account last had open here (else a blank draft).
    const [last, setLast] = useState(() => noteId ?? (partition && readLastNote(partition)))
    const [shown, setShown] = useState(section), [exploring, setExploring] = useState(false)
    if (shown !== section) { setShown(section); setExploring(false); if (noteId) setLast(noteId) }
    const selected = noteId ?? last
    const [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0)
    const [creating, setCreating] = useState(false), [notice, setNotice] = useState('')
    const [drafts] = useState(createDraftSession)
    // Notes whose pane holds text stored nowhere else (an edit storage refused, an unsent comment): they stay mounted.
    const [held, setHeld] = useState<Readonly<Record<string, readonly string[]>>>({})
    // The caret goes to the title of a note just created, once Notes is the front window.
    const [focusNote, setFocusNote] = useState<string | null>(null), [verified, setVerified] = useState<string | null>(null)
    // Sheets (publish, progress) cover the note side of the window, not the scrolling note.
    const [overlay, setOverlay] = useState<HTMLDivElement | null>(null)
    useLayoutEffect(() => () => drafts.invalidate(), [drafts])
    useEffect(() => { if (partition && noteId) writeLastNote(partition, noteId) }, [partition, noteId])
    useEffect(() => {
        if (selected || section !== null || !partition) return
        // First open on this device: a blank local draft, ready to type. Nothing is signed.
        const lease = createDraftSession(), guard = lease.capture()
        void openBlankDraft(store, partition, guard).then(id => {
            if (!id || guard.signal.aborted) return
            writeLastNote(partition, id); setLast(id); setVerified(id); setFocusNote(id); setRefresh(value => value + 1)
        }).catch(() => { if (!guard.signal.aborted) setNotice('A new note could not be saved on this device. Use New note to try again.') })
        return () => lease.invalidate()
    }, [selected, section, partition])
    const client = read.client
    useEffect(() => {
        if (section !== null || !last || last === verified || !partition || !client) return
        // A remembered note deleted since: open a blank draft instead of "Note not found" (decision A).
        let alive = true
        void Promise.all([store.getDraft({ ...partition, noteId: last }), client.note(last)]).then(([draft, note]) => {
            if (!alive) return
            if (draft || note) setVerified(last)
            else { clearLastNote(partition, last); setLast(null) }
        }).catch(() => { if (alive) setVerified(last) }) // A failed read never proves absence.
        return () => { alive = false }
    }, [section, last, verified, partition, client])
    const hold = useCallback((note: string, source: string, unsaved: boolean) => setHeld(current => {
        const sources = current[note] ?? []
        if (sources.includes(source) === unsaved) return current
        const next = { ...current }, kept = unsaved ? [...sources, source] : sources.filter(value => value !== source)
        if (kept.length) next[note] = kept; else delete next[note]
        return next
    }), [])
    const removed = useCallback((note: string, published: boolean) => {
        if (published || !partition) return
        clearLastNote(partition, note); setLast(value => value === note ? null : value)
    }, [partition])
    if (section !== null && !noteId) return <p role="alert">Invalid note address.</p>
    if (!deployment || !partition) return <section className="os-notes-welcome"><h1>Public notes</h1><p>Notes are not available on this network yet.</p></section>
    if (read.error) return <section className="os-notes-welcome"><p role="alert">Notes could not connect to this network.</p><button className="os-btn" onClick={() => retry(value => value + 1)}>Retry connection</button></section>
    if (!read.client) return <p role="status">Loading Notes…</p>
    const reader = read.client, writable = partition
    function open(id: string) { if (NOTE_ID.test(id)) { setExploring(false); onOpenNote(id) } }
    async function create() {
        if (creating) return
        setCreating(true); setNotice('')
        const guard = drafts.capture()
        const id = await openBlankDraft(store, writable, guard).catch(() => null)
        if (guard.signal.aborted) return
        setCreating(false)
        if (!id) { setNotice('The new note could not be saved on this device. Please try again.'); return }
        setRefresh(value => value + 1); setFocusNote(id); open(id)
    }
    const panes = selected && !held[selected] ? [...Object.keys(held), selected] : Object.keys(held)
    return <div className="os-notes-public os-notes-app" data-pane={noteId !== null || exploring ? 'note' : 'list'}>
        <nav className="os-notes-sidebar" aria-label="Notes list">
            <div className="os-notes-sidebar-head">
                <input type="search" className="os-notes-search" aria-label="Search notes" placeholder="Search notes" value={query} onChange={event => setQuery(event.target.value)} />
                <button type="button" className="os-btn os-notes-new" aria-label="New note" title="New note" disabled={creating} onClick={() => void create()}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
            </div>
            {notice && <p className="os-notes-list-note" role="status">{notice}</p>}
            <h2 className="os-notes-group">My notes</h2>
            <NotesList store={store} partition={partition} client={reader} owner={owner} query={query} selected={exploring ? null : selected} unsaved={Object.keys(held).filter(note => held[note].some(source => !source.startsWith(PUBLISHING)))} refresh={refresh} onOpen={open} />
            <h2 className="os-notes-group">Explore</h2>
            <button type="button" className="os-notes-row" aria-current={exploring ? 'true' : undefined} onClick={() => setExploring(true)}>
                <span className="os-notes-row-title">Public notes</span><span className="os-notes-row-meta">Read what others published</span>
            </button>
        </nav>
        <div className="os-notes-stage">
            <section className="os-notes-main" aria-label="Note">
                <button type="button" className="os-btn os-quiet os-notes-back" aria-label="Back to notes" onClick={() => { setExploring(false); if (noteId) onShowList() }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>Notes
                </button>
                {owner && <PublicOperationStatus client={reader} store={store} partition={partition} onOpen={open} />}
                {exploring && <PublicLibrary client={reader} filter={query} onOpen={open} />}
                {!exploring && !selected && <p className="os-notes-welcome" role="status">Preparing a new note…</p>}
                {/* Keyed by note: hidden panes keep their text; a pane unmounts only once nothing in it is unsaved. */}
                {panes.map(id => <div key={id} className="os-notes-pane" hidden={exploring || id !== selected}>
                    <NotePane client={reader} partition={partition} noteId={id} owner={owner} focusTitle={active && focusNote === id} shown={!exploring && id === selected}
                        overlay={overlay} walletChainId={session.walletChainId} hold={hold} saved={setRefresh} removed={removed} titleFocused={setFocusNote} />
                </div>)}
            </section>
            <div ref={setOverlay} className="os-notes-overlay" />
        </div>
    </div>
}
type PaneProps = { client: NotesReadClient; partition: NotesPartition; noteId: string; owner: string | null; focusTitle: boolean; shown: boolean; overlay: HTMLElement | null; walletChainId?: string
    hold(note: string, source: string, unsaved: boolean): void; saved(bump: (value: number) => number): void; removed(note: string, published: boolean): void; titleFocused(value: null): void }
function NotePane({ client, partition, noteId, owner, focusTitle, shown, overlay, walletChainId, hold, saved, removed, titleFocused }: PaneProps) {
    const scope = useMemo(() => ({ ...partition, noteId }), [partition, noteId])
    const pane = useMemo<NotesPane>(() => ({
        hold: (source, unsaved) => hold(noteId, source, unsaved), saved: () => saved(value => value + 1),
        deleted: published => removed(noteId, published), focusTitle, titleFocused: () => titleFocused(null), shown, overlay,
    }), [noteId, focusTitle, shown, overlay, hold, saved, removed, titleFocused])
    // Guests write local drafts too; a note without one opens in the public reader.
    return <NotesPaneContext.Provider value={pane}>{owner ? <PublicAuthoring client={client} store={store} scope={scope} walletChainId={walletChainId} />
        : <DraftEditor store={store} scope={scope} onSaved={noop} remote={<PublicNote id={noteId} client={client} owner={null}>
            {(note, _refresh, previewRoot) => note.mode >= 3 && <><PublicCommentPanel note={note} client={client} owner={null} store={store} previewRoot={previewRoot} /><PublicHistory noteId={noteId} client={client} /></>}
        </PublicNote>} />}</NotesPaneContext.Provider>
}
const noop = () => {}
