import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createDraftSession, type DraftRecord, type NotesPartition, type NotesStore } from '../../../lib/notes/drafts'
import { newNoteId } from '../../../lib/notes/config'

export function PublicDraftLibrary({ store, partition, onOpen }: { store: NotesStore; partition: NotesPartition; onOpen(id: string): void }) {
    const [session] = useState(createDraftSession), working = useRef(false)
    const [drafts, setDrafts] = useState<DraftRecord[]>([]), [limit, setLimit] = useState(20)
    const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
    const { chainId, realm, owner } = partition
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        let alive = true
        const load = () => void store.listDrafts({ chainId, realm, owner }).then(items => { if (alive) setDrafts(items.filter(item => item.payload.kind === 'public')) })
            .catch(() => { if (alive) setNotice('Local drafts could not be read. Their stored copies were kept.') })
        load(); window.addEventListener('focus', load)
        return () => { alive = false; window.removeEventListener('focus', load) }
    }, [store, chainId, realm, owner])
    async function create() {
        if (working.current) return
        working.current = true; setBusy(true)
        const guard = session.capture(), noteId = newNoteId()
        const result = await store.saveDraft({ chainId, realm, owner, noteId }, '0', { kind: 'public', title: 'Untitled note', body: '' }, guard)
        if (guard.signal.aborted) return
        working.current = false; setBusy(false)
        if (result.status === 'saved') onOpen(noteId)
        else setNotice('The new draft was not saved. No note was opened; please try again.')
    }
    return <section aria-label="Local public drafts"><h2>Your drafts on this device</h2>
        <button className="os-btn" disabled={busy} onClick={() => void create()}>New note</button>
        {drafts.slice(0, limit).map(draft => <button className="os-btn" key={draft.scope.noteId} onClick={() => onOpen(draft.scope.noteId)}>{draft.payload.kind === 'public' ? draft.payload.title || 'Untitled note' : ''}</button>)}
        {drafts.length > limit && <button className="os-btn" onClick={() => setLimit(value => value + 20)}>Show more drafts</button>}
        {notice && <p role="status">{notice}</p>}
    </section>
}
