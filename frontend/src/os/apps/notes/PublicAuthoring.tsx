import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type DraftRecord, type NotesScope, type NotesStore } from '../../../lib/notes/drafts'
import { readDraftSlot } from '../../../lib/notes/draftSlot'
import { newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { draftBase } from '../../../lib/notes/chain/draftOperation'
import { readPublicContentWritePermission } from '../../../lib/notes/chain/publicPermissions'
import { NotesChainError, publicText, type ChainNote } from '../../../lib/notes/chain/schema'
import { DraftEditor } from './DraftEditor'
import { PublicPublish } from './PublicPublish'
import { PublicNote } from './PublicNote'
import { PublicEditButton } from './PublicEditButton'
import { PublicCommentPanel } from './PublicCommentPanel'
import { PublicHistory, type ArchivedPublicDraft } from './PublicHistory'
import './notes-authoring.css'

async function writable(client: NotesReadClient, noteId: string, owner: string) {
    client.assertCurrent()
    const note = await client.note(noteId)
    if (!note || note.id !== noteId || note.mode < 3 || note.deleted || !note.body
        || !await readPublicContentWritePermission(client, note, owner)) throw new NotesChainError('stale')
    client.assertCurrent()
    return note
}
type Props = { client: NotesReadClient; store: NotesStore; scope: NotesScope }
export function PublicAuthoring(props: Props) {
    const { client, store } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    return <Workspace key={JSON.stringify([lease.id, props.scope])} {...props} />
}
function Workspace({ client, store, scope }: Props) {
    const [session] = useState(createDraftSession), working = useRef(false)
    const [local, setLocal] = useState(false), [opened, setOpened] = useState(false), [editing, setEditing] = useState(false)
    const [generation, reloadEditor] = useState(0), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        const guard = session.capture(); let alive = true
        void store.getDraft(scope).then(async draft => {
            if (!alive || guard.signal.aborted) return
            const publicDraft = draft?.payload.kind === 'public'
            setLocal(publicDraft)
            if (!publicDraft) return
            try {
                const note = await client.note(scope.noteId)
                if (alive && !guard.signal.aborted && note === null) { setOpened(true); setEditing(true) }
            } catch { if (alive && !guard.signal.aborted) setNotice('The published note could not be read. Your local draft is available; publication still requires live checks.') }
        }).catch(() => { if (alive && !guard.signal.aborted) setNotice('Local draft storage could not be read. Its saved copy was kept.') })
        return () => { alive = false }
    }, [store, client, scope, session])
    async function prepare(archived?: ArchivedPublicDraft) {
        if (working.current || (archived && archived.noteId !== scope.noteId)) return
        working.current = true; setBusy(true)
        const guard = session.capture()
        try {
            const slot = await readDraftSlot(store, scope, guard)
            if (slot.draft) {
                if (slot.draft.payload.kind !== 'public') throw new Error('Unavailable draft')
                setLocal(true)
                if (archived) { setNotice('A local draft already exists. It was not replaced by this historical version.'); return }
                setOpened(true); setEditing(true); setNotice('Your existing draft was opened unchanged. Compare it with the published revision before publishing.'); return
            }
            const note = await writable(client, scope.noteId, scope.owner)
            if (guard.signal.aborted) return
            const result = await store.saveDraft(scope, slot.revision, { kind: 'public', title: archived?.title ?? publicText(note.title, true), body: archived?.body ?? publicText(note.body!), base: draftBase(note) }, guard)
            if (guard.signal.aborted) return
            if (result.status !== 'saved') { setNotice('Another window changed this draft or storage is unavailable. No saved draft was replaced.'); return }
            setLocal(true); setOpened(true); setEditing(true); reloadEditor(value => value + 1)
            setNotice(archived ? `Historical revision ${archived.sourceStateRevision} copied into a new local draft. Review it before a normal Commit.` : 'A local draft was saved from the current published revision.')
        } catch { if (!guard.signal.aborted) setNotice('A safe editing baseline could not be prepared. The note, permissions or storage changed. Your saved draft was kept.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    return <div>
        {local && <button className="os-btn" onClick={() => { setOpened(true); setEditing(value => !value) }}>{editing ? 'Read published note' : 'Open local draft'}</button>}
        {busy && <p role="status">Preparing local draft…</p>}
        {notice && <p role="status">{notice}</p>}
        <div hidden={editing}>
            <PublicNote id={scope.noteId} client={client} owner={scope.owner}
                encrypted={() => <p>Encrypted notes are not available in this public view.</p>}
                editAction={note => !editing && <PublicEditButton note={note} owner={scope.owner} client={client} onEdit={() => void prepare()} />}>
                {(note, _refresh, previewRoot) => <>
                    {!editing && note.mode >= 3 && <PublicCommentPanel note={note} client={client} owner={scope.owner} store={store} previewRoot={previewRoot} />}
                    {note.mode >= 3 && <PublicHistory noteId={scope.noteId} client={client} onRestore={draft => prepare(draft)} />}
                </>}
            </PublicNote>
        </div>
        {opened && <div hidden={!editing}><DraftEditor key={generation} scope={scope} store={store} onSaved={() => setLocal(true)}
            actions={editing ? draft => <PublicDraftActions key={draft.localRevision} draft={draft} client={client} store={store} onRebased={() => reloadEditor(value => value + 1)} /> : undefined} /></div>}
    </div>
}
function PublicDraftActions({ draft, client, store, onRebased }: { draft: DraftRecord; client: NotesReadClient; store: NotesStore; onRebased(): void }) {
    const [session] = useState(createDraftSession), working = useRef(false)
    const [current, setCurrent] = useState<ChainNote | null>(null), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
    useLayoutEffect(() => () => session.invalidate(), [session])
    async function compare(apply: boolean) {
        if (working.current || draft.payload.kind !== 'public') return
        working.current = true; setBusy(true)
        const guard = session.capture()
        try {
            const note = await writable(client, draft.scope.noteId, draft.scope.owner)
            if (guard.signal.aborted) return
            if (!apply) { setCurrent(note); setNotice('Compare the published version below with your saved draft. Keeping your text against this revision is an explicit new baseline.'); return }
            if (!current || note.stateRevision !== current.stateRevision || note.ownerGeneration !== current.ownerGeneration) throw new NotesChainError('stale')
            const result = await store.saveDraft(draft.scope, draft.localRevision, { ...draft.payload, base: draftBase(note) }, guard)
            if (guard.signal.aborted) return
            if (result.status !== 'saved') throw new NotesChainError('stale')
            onRebased()
        } catch { if (!guard.signal.aborted) setNotice('Comparison or baseline save failed. Your draft was kept; reload the comparison before trying again.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    return <>
        <PublicPublish draft={draft} client={client} store={store} />
        <details className="os-notes-publish"><summary>Compare with published revision</summary>
            <button className="os-btn" disabled={busy} onClick={() => void compare(false)}>Load comparison</button>
            {current && <div><p>Published revision {current.stateRevision}</p><h3>{publicText(current.title, true)}</h3><pre>{publicText(current.body!)}</pre>
                <button className="os-btn" disabled={busy} onClick={() => void compare(true)}>Keep my saved text against revision {current.stateRevision}</button></div>}
            {notice && <p role="status">{notice}</p>}
        </details>
    </>
}
