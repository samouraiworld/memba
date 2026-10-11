import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type DraftBase, type DraftRecord, type NotesScope, type NotesStore } from '../../../lib/notes/drafts'
import { readDraftSlot } from '../../../lib/notes/draftSlot'
import { newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { draftBase } from '../../../lib/notes/chain/draftOperation'
import { readPublicContentWritePermission } from '../../../lib/notes/chain/publicPermissions'
import { planDraftRebase, type RebasePlan } from '../../../lib/notes/chain/rebase'
import { NotesChainError, publicText, type ChainNote } from '../../../lib/notes/chain/schema'
import { NotesTimeoutError, useNoteFreshness, withTimeout } from '../../../lib/notes/freshness'
import { DraftEditor } from './DraftEditor'
import { PublicPublish } from './PublicPublish'
import { PublicNote } from './PublicNote'
import { PublicEditButton } from './PublicEditButton'
import { PublicCommentPanel } from './PublicCommentPanel'
import { PublicCollaborationControls } from './PublicCollaborationControls'
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
type Conflict = Extract<RebasePlan, { kind: 'conflict' }>
/** `undefined` while the first read is pending; `null` when the note is not published. */
type Live = { note: ChainNote | null | undefined; failed: boolean }
const short = (address: string) => address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address
const timedOut = 'The network did not answer in time. Nothing was changed and your text is kept. Try again.'
function rebaseMessage(plan: Extract<RebasePlan, { kind: 'replace' | 'merged' }>) {
    return plan.kind === 'merged' ? `Updated to revision ${plan.latest.stateRevision} — your changes were kept.` : `Editing the latest published revision (${plan.latest.stateRevision}).`
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
    const [conflict, setConflict] = useState<Conflict | null>(null)
    /** Live note while the editor is open, re-read after confirmed changes and refocus. */
    const [live, setLive] = useState<Live>({ note: undefined, failed: false }), [liveCheck, recheckLive] = useState(0)
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        if (!opened) return
        const guard = session.capture()
        void withTimeout(client.note(scope.noteId)).then(note => { if (!guard.signal.aborted) setLive({ note, failed: false }) })
            .catch(() => { if (!guard.signal.aborted) setLive(value => ({ ...value, failed: true })) })
    }, [opened, liveCheck, client, scope.noteId, session])
    useNoteFreshness(client.chainId, scope.noteId, useCallback(() => recheckLive(value => value + 1), []))
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
    const show = () => { setOpened(true); setEditing(true); recheckLive(value => value + 1) }
    /** Opens the editor on the latest revision: a fresh copy, an untouched draft, a clean rebase, or an explicit conflict. */
    async function prepare(archived?: ArchivedPublicDraft) {
        if (working.current || (archived && archived.noteId !== scope.noteId)) return
        working.current = true; setBusy(true); setNotice('')
        const guard = session.capture()
        try {
            const slot = await withTimeout(readDraftSlot(store, scope, guard))
            const draft = slot.draft, payload = draft?.payload.kind === 'public' ? draft.payload : null
            if (draft && !payload) throw new Error('Unavailable draft')
            if (draft) setLocal(true)
            if (draft && archived) { setNotice('A local draft already exists. It was not replaced by this historical version.'); return }
            // A creation draft whose note is not published yet opens as it is.
            if (payload && !payload.base && await withTimeout(client.note(scope.noteId)) === null) { if (!guard.signal.aborted) show(); return }
            if (guard.signal.aborted) return
            let note: ChainNote
            try { note = await withTimeout(writable(client, scope.noteId, scope.owner)) } catch (error) {
                if (guard.signal.aborted) return
                const refused = error instanceof NotesChainError && error.code === 'stale'
                if (!refused && !draft) throw error
                if (draft) show()
                setNotice(refused ? draft ? 'You cannot publish changes to this note from this account right now. Your draft is kept on this device; you can export it.'
                    : 'This note cannot be edited from your account now: its permissions or state changed. Nothing was saved.'
                    : error instanceof NotesTimeoutError ? `${timedOut} Your local draft was opened; publishing checks the latest revision first.`
                    : 'The published note could not be read. Your local draft was opened; publishing checks the latest revision first.')
                return
            }
            if (guard.signal.aborted) return
            if (!draft) {
                const result = await withTimeout(store.saveDraft(scope, slot.revision, { kind: 'public', title: archived?.title ?? publicText(note.title, true), body: archived?.body ?? publicText(note.body!), base: draftBase(note) }, guard))
                if (guard.signal.aborted) return
                if (result.status !== 'saved') { setNotice('Another window changed this draft or storage is unavailable. No saved draft was replaced.'); return }
                setLocal(true); show(); setConflict(null); reloadEditor(value => value + 1)
                setNotice(archived ? `Historical revision ${archived.sourceStateRevision} copied into a new local draft. Review it before a normal Commit.` : `Editing the latest published revision (${note.stateRevision}).`)
                return
            }
            if (!payload) return
            const plan = await withTimeout(planDraftRebase(client, payload, note))
            if (guard.signal.aborted) return
            if (plan.kind === 'current') {
                show(); setConflict(null)
                const unchanged = payload.title === publicText(note.title, true) && payload.body === publicText(note.body!)
                setNotice(unchanged ? `Editing the latest published revision (${note.stateRevision}).` : `Your unpublished changes to revision ${note.stateRevision} were opened.`)
                return
            }
            if (plan.kind === 'conflict') { show(); setConflict(plan); return }
            const result = await withTimeout(store.saveDraft(scope, draft.localRevision, { kind: 'public', title: plan.title, body: plan.body, base: draftBase(plan.latest) }, guard))
            if (guard.signal.aborted) return
            if (result.status !== 'saved') { setNotice('Another window changed this draft or storage is unavailable. No saved draft was replaced.'); return }
            show(); setConflict(null); reloadEditor(value => value + 1); setNotice(rebaseMessage(plan))
        } catch (error) {
            if (!guard.signal.aborted) setNotice(error instanceof NotesTimeoutError ? timedOut : 'The latest revision could not be checked. Nothing was changed and your saved draft was kept. Try again.')
        } finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    function toggle() {
        if (editing) { setEditing(false); return }
        // Once open, the editor keeps its own unsaved text; the draft actions re-check freshness.
        if (opened) setEditing(true); else void prepare()
    }
    const rebased = useCallback((message: string, reload = true) => { setConflict(null); setNotice(message); if (reload) reloadEditor(value => value + 1); recheckLive(value => value + 1) }, [])
    return <div>
        {local && <button className="os-btn" onClick={toggle}>{editing ? 'Read published note' : 'Open local draft'}</button>}
        {busy && <p role="status">Preparing local draft…</p>}
        {notice && <p role="status">{notice}</p>}
        <div hidden={editing}>
            <PublicNote id={scope.noteId} client={client} owner={scope.owner}
                encrypted={() => <p>Encrypted notes are not available in this public view.</p>}
                editAction={note => !editing && <PublicEditButton note={note} owner={scope.owner} client={client} onEdit={() => opened ? setEditing(true) : void prepare()} />}>
                {(note, refresh, previewRoot) => <>
                    {!editing && <PublicCollaborationControls note={note} client={client} owner={scope.owner} store={store} onChanged={refresh} />}
                    {!editing && note.mode >= 3 && <PublicCommentPanel note={note} client={client} owner={scope.owner} store={store} previewRoot={previewRoot} />}
                    {note.mode >= 3 && <PublicHistory noteId={scope.noteId} client={client} onRestore={draft => prepare(draft)} />}
                </>}
            </PublicNote>
        </div>
        {opened && <div hidden={!editing}>
            <DraftEditor key={generation} scope={scope} store={store} onSaved={() => setLocal(true)}
                actions={editing ? (draft, published) => <PublicDraftActions key={draft.localRevision} draft={draft} client={client} store={store} published={published}
                    live={live} recheck={() => recheckLive(value => value + 1)} conflict={conflict} onRebased={rebased} onConflict={setConflict} onNotice={setNotice} /> : undefined} />
        </div>}
    </div>
}

/**
 * Overlap: the user's text stays untouched until they choose, after seeing the other version.
 * Rendered with the editor's saved snapshot, so a choice never races unsaved typing.
 */
function RebaseConflict({ plan, draft, store, published, onResolved }: {
    plan: Conflict; draft: DraftRecord; store: NotesStore
    published(base: DraftBase, fromRevision: string): Promise<boolean>; onResolved(message: string, reload?: boolean): void
}) {
    const latest = plan.latest, revision = latest.stateRevision, owner = draft.scope.owner
    const [session] = useState(createDraftSession), working = useRef(false)
    const [seen, setSeen] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
    useLayoutEffect(() => () => session.invalidate(), [session])
    const fields = plan.fields.length === 2 ? 'the title and the text' : plan.fields[0] === 'title' ? 'the title' : 'the text'
    async function choose(mine: boolean) {
        if (working.current || draft.payload.kind !== 'public') return
        working.current = true; setBusy(true); setNotice('')
        const guard = session.capture()
        try {
            if (mine) {
                // The editor keeps its text and only moves its baseline.
                if (!await withTimeout(published(draftBase(latest), draft.localRevision))) { if (!guard.signal.aborted) setNotice('Your draft changed in another window. Nothing was replaced.'); return }
                onResolved(`Your version now follows revision ${revision}. Publishing it replaces their changes, so review it first.`, false)
                return
            }
            const copy = await withTimeout(store.saveDraft({ ...draft.scope, noteId: newNoteId() }, '0', { kind: 'public', title: draft.payload.title, body: draft.payload.body }, guard))
            if (guard.signal.aborted) return
            if (copy.status !== 'saved') { setNotice('Your text could not be saved as a separate draft, so nothing was replaced. Export it or try again.'); return }
            const result = await withTimeout(store.saveDraft(draft.scope, draft.localRevision, { kind: 'public', ...plan.theirs, base: draftBase(latest) }, guard))
            if (guard.signal.aborted) return
            if (result.status !== 'saved') { setNotice('Your draft changed in another window. Nothing was replaced; your text was also saved as a separate draft.'); return }
            onResolved(`Editing revision ${revision}. Your previous text was saved as a separate draft on this device.`)
        } catch (error) { if (!guard.signal.aborted) setNotice(error instanceof NotesTimeoutError ? timedOut : 'Your draft could not be updated. Nothing was replaced.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    return <section className="os-notes-message" role="alert" aria-label="Newer version published">
        <p>{latest.actor === owner ? `You published a newer version (revision ${revision}) from another window or device.` : `Someone published a newer version (revision ${revision} by ${short(latest.actor)}).`} Your text is kept.</p>
        <p>Both versions changed {fields}{plan.baseRevision ? ` since revision ${plan.baseRevision}` : ''}, so they cannot be combined automatically.</p>
        <button className="os-btn" aria-expanded={seen} onClick={() => setSeen(true)}>See their changes</button>
        <button className="os-btn" disabled={!seen || busy} onClick={() => void choose(true)}>Put my version on top of revision {revision}</button>
        <button className="os-btn os-quiet" disabled={busy} onClick={() => void choose(false)}>Start from revision {revision}</button>
        {seen && <div><p>Revision {revision}</p><h3>{plan.theirs.title}</h3><pre>{plan.theirs.body}</pre></div>}
        {notice && <p role="status">{notice}</p>}
    </section>
}

type ActionsProps = {
    draft: DraftRecord; client: NotesReadClient; store: NotesStore; conflict: Conflict | null; live: Live; recheck(): void
    published(base: DraftBase, fromRevision: string): Promise<boolean>
    onRebased(message: string, reload?: boolean): void; onConflict(plan: Conflict): void; onNotice(message: string): void
}
function PublicDraftActions({ draft, client, store, conflict, live, recheck, published, onRebased, onConflict, onNotice }: ActionsProps) {
    const [session] = useState(createDraftSession), working = useRef(false), [busy, setBusy] = useState(false)
    useLayoutEffect(() => () => session.invalidate(), [session])
    const base = draft.payload.kind === 'public' ? draft.payload.base : undefined
    /** True only when the saved draft already follows the latest revision; otherwise it reports what happened. */
    const update = useCallback(async (fromReview = false): Promise<boolean> => {
        if (draft.payload.kind !== 'public') return false
        if (working.current) { onNotice('Still checking the latest revision. Try again in a moment.'); return false }
        working.current = true; setBusy(true)
        const guard = session.capture()
        try {
            const note = await withTimeout(writable(client, draft.scope.noteId, draft.scope.owner))
            if (guard.signal.aborted) return false
            const plan = await withTimeout(planDraftRebase(client, draft.payload, note))
            if (guard.signal.aborted) return false
            if (plan.kind === 'current') return true
            if (plan.kind === 'conflict') { onConflict(plan); return false }
            const result = await withTimeout(store.saveDraft(draft.scope, draft.localRevision, { kind: 'public', title: plan.title, body: plan.body, base: draftBase(plan.latest) }, guard))
            if (guard.signal.aborted) return false
            if (result.status !== 'saved') { onNotice('Your draft changed in another window. Nothing was replaced; review again.'); return false }
            onRebased(`${rebaseMessage(plan)}${plan.kind === 'replace' ? ' Your draft had no unpublished changes.' : ''}${fromReview ? ' Check it, then select Review publication again.' : ''}`)
            return false
        } catch (error) {
            if (!guard.signal.aborted) onNotice(error instanceof NotesTimeoutError ? timedOut
                : error instanceof NotesChainError && error.code === 'stale' ? 'You can no longer publish changes to this note: its permissions or state changed. Your draft is kept.'
                : 'The latest revision could not be checked. Nothing was published and your text is kept. Try again.')
            return false
        } finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }, [client, store, draft, session, onConflict, onRebased, onNotice])
    if (live.note === undefined) return live.failed ? <p role="status">The published note could not be checked. <button className="os-btn os-quiet" onClick={recheck}>Check again</button></p>
        : <p role="status">Checking the published note…</p>
    const note = live.note, exists = !!note && !note.deleted
    const behind = exists && (!base || base.stateRevision !== note.stateRevision), conflicted = !!conflict
    return <>
        {conflict && <RebaseConflict key={conflict.latest.stateRevision} plan={conflict} draft={draft} store={store} published={published} onResolved={onRebased} />}
        {behind && !conflicted && <p role="status">{base ? `Revision ${note.stateRevision} was published after your draft started (revision ${base.stateRevision}).` : `This note is already published (revision ${note.stateRevision}).`}{' '}
            <button className="os-btn" disabled={busy} onClick={() => void update()}>Update my draft to revision {note.stateRevision}</button></p>}
        {/* A draft without a baseline is a creation: never offer it for a note that already exists. */}
        {(base ? !conflicted : !exists) && <PublicPublish draft={draft} client={client} store={store} beforeReview={base ? () => update(true) : undefined}
            onPublished={confirmed => {
                void published(draftBase(confirmed), draft.localRevision).then(moved => onNotice(moved
                    ? `Published as revision ${confirmed.stateRevision}. Your draft now follows it; new edits stay on this device until you publish them.`
                    : `Published as revision ${confirmed.stateRevision}. Your draft changed elsewhere; it will be updated to the latest revision before your next publication.`))
            }} />}
    </>
}
