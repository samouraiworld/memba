import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createDraftSession, type DraftBase, type DraftRecord, type NotesScope, type NotesStore } from '../../../lib/notes/drafts'
import { DraftWriteUnknownError, readDraftSlot, saveDraftBounded } from '../../../lib/notes/draftSlot'
import { newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { draftBase } from '../../../lib/notes/chain/draftOperation'
import { readPublicContentWritePermission } from '../../../lib/notes/chain/publicPermissions'
import { planDraftRebase, type RebasePlan } from '../../../lib/notes/chain/rebase'
import { NotesChainError, publicText, type ChainNote } from '../../../lib/notes/chain/schema'
import { NotesTimeoutError, readFresh, useNoteRefresh, withTimeout } from '../../../lib/notes/freshness'
import { copyTitle, trimPublicTitle } from '../../../lib/notes/publicFields'
import type { ConflictLine } from '../../../lib/notes/merge'
import { DraftEditor, type EditorActions } from './DraftEditor'
import { PublicDelete, PublicPublish, PublishProgressSheet, type NoteReport, type PrivateCreate, type PublishProgress } from './PublicPublish'
import { NoteSkeleton, PublicNote } from './PublicNote'
import { PublicEditButton } from './PublicEditButton'
import type { ArchivedPublicDraft } from './PublicHistory'
import { NoteSharePopover } from './NoteSharePopover'
import { NoteSidePanel } from './NoteSidePanel'
import { NoteBanner, NoteStatus, type Notice } from './NoteHeader'
import { useNotesPane } from './notesPane'
import { differingLines, shortAddress } from './notesFormat'
import './notes-authoring.css'

/** The note is live and public, but this account may no longer publish changes to it (the owner closed editing). */
class EditingClosed extends Error {}
async function writable(client: NotesReadClient, noteId: string, owner: string) {
    client.assertCurrent()
    const note = await client.note(noteId)
    if (!note || note.id !== noteId || note.mode < 3 || note.deleted || !note.body) throw new NotesChainError('stale')
    if (!await readPublicContentWritePermission(client, note, owner)) throw new EditingClosed()
    client.assertCurrent()
    return note
}
type Conflict = Extract<RebasePlan, { kind: 'conflict' }>
/** `undefined` while the first read is pending; `null` when the note is not published. */
type Live = { note: ChainNote | null | undefined; failed: boolean }
type Saved = { title: string; body: string; base?: DraftBase }
const kept = 'Your text is kept.'
const info = (text: string): Notice => ({ tone: 'info', text })
const timedOut: Notice = { tone: 'warn', title: 'The network did not answer in time.', text: `Nothing was changed. ${kept} Try again.` }
const storageUnknown: Notice = { tone: 'warn', text: 'This device did not confirm whether your draft was updated. Your text is still in the editor and is saved again as you type.' }
const closed = (draft: boolean): Notice => ({ tone: 'warn', title: 'Editing was closed.', text: draft ? 'The owner closed editing of this note, so you can no longer publish here. Your text is kept on this device.' : 'The owner closed editing of this note. Nothing was saved.' })
const lagging = (revision: string): Notice => ({ tone: 'info', title: 'The network is catching up.', text: `It has not shown revision ${revision} of your draft yet. Nothing was changed and ${kept.toLowerCase()} Try again in a moment.` })
const openedAsIs = (error: unknown): Notice => ({ tone: 'warn', text: `${error instanceof NotesTimeoutError ? 'The network did not answer in time.' : 'The latest revision could not be checked.'} Your draft was opened as it is; it is checked against the latest revision before publishing.` })
/** Notes are never removed: an absent or older answer after a newer one is node lag, not news. */
const newer = (shown: ChainNote | null | undefined, read: ChainNote | null) => shown && (!read || BigInt(read.stateRevision) < BigInt(shown.stateRevision)) ? shown : read
const sameText = (saved: Saved, note: ChainNote) => !!note.body && trimPublicTitle(saved.title) === publicText(note.title, true) && saved.body === publicText(note.body)
function rebased(plan: Extract<RebasePlan, { kind: 'replace' | 'merged' }>, owner: string): Notice {
    const who = plan.latest.actor === owner ? 'You' : shortAddress(plan.latest.actor)
    return info(plan.kind === 'merged' ? `Updated to revision ${plan.latest.stateRevision}. ${who} published a change while you were editing; your changes are kept.` : `Updated to revision ${plan.latest.stateRevision}, the latest published version.`)
}

type Props = {
    client: NotesReadClient; store: NotesStore; scope: NotesScope
    /** The network Adena is on, when known. */
    walletChainId?: string
    /** A private note's reader and editor (lazy private chunk); without it, the plain "Private note" placeholder. */
    encrypted?(note: ChainNote, refresh: () => void, report: NoteReport): ReactNode
    /** Publishing a new note privately (lazy private chunk); without it, the private choice stays unavailable. */
    privateCreate?: PrivateCreate
}
const settled = () => {}
export function PublicAuthoring(props: Props) {
    const { client, store } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    return <Workspace key={JSON.stringify([lease.id, props.scope])} {...props} />
}
/** The published note is the page; Edit turns the same page into its editor, Publish brings it back. */
function Workspace({ client, store, scope, walletChainId, encrypted, privateCreate }: Props) {
    const [session] = useState(createDraftSession), working = useRef(false), updating = useRef(false), pane = useNotesPane()
    const [start, setStart] = useState<'checking' | 'ready'>('checking'), [saved, setSaved] = useState<Saved | null>(null), [savedTick, reread] = useState(0)
    const [opened, setOpened] = useState(false), [editing, setEditing] = useState(false)
    const [generation, reloadEditor] = useState(0), [notice, setNotice] = useState<Notice | null>(null), [busy, setBusy] = useState(false), [checking, setChecking] = useState(false)
    const [conflict, setConflict] = useState<Conflict | null>(null)
    /** The published note could not be read while this device holds a draft: the draft must stay one click away. */
    const [unread, setUnread] = useState(false)
    const [progress, setProgress] = useState<PublishProgress | null>(null), [deleting, setDeleting] = useState<ChainNote | null>(null)
    /** Live note while the editor is open, re-read after confirmed changes and refocus. */
    const [live, setLive] = useState<Live>({ note: undefined, failed: false }), latestRead = useRef(0)
    const { tick: liveCheck, minimum, bump: recheckLive } = useNoteRefresh(client.chainId, scope.noteId)
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        if (!opened) return
        // Only the most recently issued read may answer, and it never moves the note backward.
        const guard = session.capture(), sequence = ++latestRead.current
        const current = () => !guard.signal.aborted && sequence === latestRead.current
        void readFresh(() => withTimeout(client.note(scope.noteId)), note => note?.stateRevision ?? null, minimum(), current)
            .then(note => { if (note !== undefined && current()) setLive(value => ({ note: newer(value.note, note), failed: false })) })
            .catch(() => { if (current()) setLive(value => ({ ...value, failed: true })) })
    }, [opened, liveCheck, minimum, client, scope.noteId, session])
    // This device's draft: whether the page says "Unpublished changes", and whether a never-published draft opens in its editor.
    useEffect(() => {
        const guard = session.capture(); let alive = true
        const live = () => alive && !guard.signal.aborted
        void withTimeout(store.getDraft(scope)).then(async draft => {
            if (!live()) return
            const payload = draft?.payload.kind === 'public' ? draft.payload : null
            setSaved(payload)
            setUnread(false)
            if (!payload || savedTick) { setStart('ready'); return }
            try {
                const note = await withTimeout(client.note(scope.noteId))
                if (live() && note === null) { setOpened(true); setEditing(true) }
            } catch { if (live()) setUnread(true) }
            if (live()) setStart('ready')
        }).catch(() => { if (live()) { setStart('ready'); setNotice({ tone: 'warn', text: 'Drafts on this device could not be read. Their saved copies were kept.' }) } })
        return () => { alive = false }
    }, [store, client, scope, session, savedTick])
    /** This device's draft follows an older revision than the published one (F21): what to say about it on the read page. */
    const [stale, setStale] = useState<{ for: Saved; state: { base: string; latest: string } | { deleted: true } | null } | null>(null)
    useEffect(() => {
        const base = saved?.base
        // After the start check, and not while the published note cannot be read (that banner already offers the draft).
        if (!saved || !base || opened || start !== 'ready' || unread) return
        const guard = session.capture(); let alive = true
        const live = () => alive && !guard.signal.aborted
        const setBehind = (state: { base: string; latest: string } | { deleted: true } | null) => setStale({ for: saved, state })
        void (async () => {
            const note = await withTimeout(client.note(scope.noteId))
            if (!live()) return
            // A deleted note keeps nothing to publish to: its draft here can be removed (F32).
            if (note?.deleted) { setBehind({ deleted: true }); return }
            if (!note || !note.body || BigInt(note.stateRevision) <= BigInt(base.stateRevision)) { setBehind(null); return }
            const plan = await withTimeout(planDraftRebase(client, saved, note)).catch(() => null)
            if (!live()) return
            if (plan?.kind === 'replace') {
                // The draft holds nothing of its own: it follows the published text without a word.
                const slot = await withTimeout(readDraftSlot(store, scope, guard))
                const payload = slot.draft?.payload.kind === 'public' ? slot.draft.payload : null
                if (!live() || !slot.draft || !payload || payload.title !== saved.title || payload.body !== saved.body) return
                const result = await saveDraftBounded(store, scope, slot.draft.localRevision, { kind: 'public', title: plan.title, body: plan.body, base: draftBase(plan.latest) }, guard)
                if (live() && result.status === 'saved') { setBehind(null); reread(value => value + 1); pane?.saved() }
                return
            }
            setBehind({ base: base.stateRevision, latest: note.stateRevision })
        })().catch(() => { if (live()) setBehind(null) })
        return () => { alive = false }
    }, [saved, opened, start, unread, client, store, scope, session, liveCheck, pane])
    async function discardBehind(question: string) {
        if (working.current || !window.confirm(question)) return
        working.current = true; setBusy(true)
        const guard = session.capture()
        try {
            const slot = await withTimeout(readDraftSlot(store, scope, guard))
            const result = slot.draft ? await withTimeout(store.deleteDraft(scope, slot.draft.localRevision, guard)) : null
            if (guard.signal.aborted) return
            if (result && result.status !== 'saved') { setNotice({ tone: 'warn', text: 'Your draft could not be discarded. It is kept on this device.' }); return }
            setStale(null); setNotice(null); reread(value => value + 1); pane?.saved()
        } catch { if (!guard.signal.aborted) setNotice({ tone: 'warn', text: 'Your draft could not be discarded. It is kept on this device.' }) }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    // Only for the draft as last read, while the read page shows it.
    const behind = stale && stale.for === saved && !opened && start === 'ready' && !unread ? stale.state : null
    const show = () => { setOpened(true); setEditing(true); recheckLive() }
    /** Opens the editor on the latest revision: a fresh copy, an untouched draft, a clean rebase, or an explicit conflict. */
    async function prepare(archived?: ArchivedPublicDraft) {
        if (working.current || (archived && archived.noteId !== scope.noteId)) return
        working.current = true; setBusy(true); setNotice(null)
        const guard = session.capture()
        let opensAsIs = false
        try {
            const slot = await withTimeout(readDraftSlot(store, scope, guard))
            const draft = slot.draft, payload = draft?.payload.kind === 'public' ? draft.payload : null
            // From here on a failure opens the saved draft unchanged: its text is never out of reach.
            opensAsIs = !!payload
            if (draft && !payload) throw new Error('Unavailable draft')
            // A creation draft whose note is not published yet opens as it is.
            if (payload && !payload.base && await withTimeout(client.note(scope.noteId)) === null) { if (!guard.signal.aborted) show(); return }
            if (guard.signal.aborted) return
            let note: ChainNote
            try { note = await withTimeout(writable(client, scope.noteId, scope.owner)) } catch (error) {
                if (guard.signal.aborted) return
                const refused = error instanceof EditingClosed || (error instanceof NotesChainError && error.code === 'stale')
                if (!refused) throw error
                if (draft) show()
                setNotice(error instanceof EditingClosed ? closed(!!draft) : { tone: 'warn', text: draft ? `You cannot publish changes to this note from this account now. Your draft is kept on this device; you can export it.` : 'This note cannot be edited from your account now: its permissions or state changed. Nothing was saved.' })
                return
            }
            if (guard.signal.aborted) return
            // An earlier version replaces a draft only when that draft holds nothing unpublished.
            if (draft && archived && (!payload || !sameText(payload, note))) {
                setNotice({ tone: 'warn', text: `Your draft of this note has unpublished changes, so it was not replaced by revision ${archived.sourceStateRevision}. Publish or discard it first (Edit, then Cancel), then use this version again.` })
                return
            }
            if (!draft || archived) {
                const result = await saveDraftBounded(store, scope, draft ? draft.localRevision : slot.revision, { kind: 'public', title: archived?.title ?? publicText(note.title, true), body: archived?.body ?? publicText(note.body!), base: draftBase(note) }, guard)
                if (guard.signal.aborted) return
                if (result.status !== 'saved') { setNotice({ tone: 'warn', text: 'Another window changed this draft or storage is unavailable. No saved draft was replaced.' }); return }
                show(); setConflict(null); reloadEditor(value => value + 1); reread(value => value + 1)
                if (archived) setNotice(info(`Revision ${archived.sourceStateRevision} was copied into your draft. Publishing it makes it the latest version.`))
                return
            }
            if (!payload) return
            const plan = await withTimeout(planDraftRebase(client, payload, note))
            if (guard.signal.aborted) return
            if (plan.kind === 'behind') { show(); setNotice(lagging(plan.baseRevision)); return }
            if (plan.kind === 'current') { show(); setConflict(null); return }
            if (plan.kind === 'conflict') { show(); setConflict(plan); return }
            const result = await saveDraftBounded(store, scope, draft.localRevision, { kind: 'public', title: plan.title, body: plan.body, base: draftBase(plan.latest) }, guard)
            if (guard.signal.aborted) return
            if (result.status !== 'saved') { show(); reloadEditor(value => value + 1); setNotice({ tone: 'warn', text: 'Another window changed this draft or storage is unavailable. Your saved draft was opened as it is.' }); return }
            show(); setConflict(null); reloadEditor(value => value + 1); setNotice(plan.kind === 'merged' ? rebased(plan, scope.owner) : null)
        } catch (error) {
            if (guard.signal.aborted) return
            if (opensAsIs) { show(); setNotice(openedAsIs(error)) }
            else setNotice(error instanceof NotesTimeoutError ? timedOut : error instanceof DraftWriteUnknownError ? storageUnknown : { tone: 'warn', text: 'The latest revision could not be checked. Nothing was changed. Try again.' })
        } finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    const moved = useCallback((message: Notice | null, reload = true) => { setConflict(null); setNotice(message); if (reload) reloadEditor(value => value + 1); recheckLive() }, [recheckLive])
    /** The verified latest note when the saved draft already follows it; otherwise null, once the page says what happened. */
    async function update(draft: DraftRecord, fromReview = false): Promise<ChainNote | null> {
        if (draft.payload.kind !== 'public') return null
        if (updating.current) { setNotice(info('Still checking the latest revision. Try again in a moment.')); return null }
        updating.current = true; setChecking(true)
        const guard = session.capture()
        try {
            const note = await withTimeout(writable(client, draft.scope.noteId, draft.scope.owner))
            if (guard.signal.aborted) return null
            const plan = await withTimeout(planDraftRebase(client, draft.payload, note))
            if (guard.signal.aborted) return null
            if (plan.kind === 'current') return note
            if (plan.kind === 'behind') { setNotice(lagging(plan.baseRevision)); return null }
            if (plan.kind === 'conflict') { setConflict(plan); setNotice(null); return null }
            const result = await saveDraftBounded(store, draft.scope, draft.localRevision, { kind: 'public', title: plan.title, body: plan.body, base: draftBase(plan.latest) }, guard)
            if (guard.signal.aborted) return null
            if (result.status !== 'saved') { setNotice({ tone: 'warn', text: 'Your draft changed in another window. Nothing was replaced; press Publish again.' }); return null }
            const message = rebased(plan, draft.scope.owner)
            moved({ ...message, text: `${message.text}${fromReview ? ' Check it, then press Publish again.' : ''}` })
            return null
        } catch (error) {
            if (!guard.signal.aborted) setNotice(error instanceof NotesTimeoutError ? timedOut : error instanceof EditingClosed ? closed(true)
                : error instanceof DraftWriteUnknownError ? storageUnknown
                : error instanceof NotesChainError && error.code === 'stale' ? { tone: 'warn', text: 'You can no longer publish changes to this note: it was deleted or its permissions changed. Your draft is kept.' }
                : { tone: 'warn', text: `The latest revision could not be checked. Nothing was published and ${kept.toLowerCase()} Try again.` })
            return null
        } finally { if (!guard.signal.aborted) { updating.current = false; setChecking(false) } }
    }
    function cancel({ title, body, discard }: { title: string; body: string; discard(): Promise<boolean> }) {
        const published = live.note
        // The published text is not known (its read failed or has not answered yet): back to the page, the draft kept as it is.
        if (published === undefined) { setEditing(false); return }
        // Leaving without changes keeps the (identical) draft; changes are discarded only once confirmed.
        if (!published || !sameText({ title, body }, published)) {
            if (!window.confirm('Discard your unpublished changes? They are deleted from this device. Choose Cancel to keep editing.')) return
            void discard().then(done => {
                if (!done) { setNotice({ tone: 'warn', text: `Your draft could not be discarded. ${kept}` }); return }
                setOpened(false); setEditing(false); setConflict(null); setNotice(null); reread(value => value + 1)
            })
            return
        }
        setEditing(false); setNotice(null)
    }
    // A message set by the confirmation (e.g. the draft changed meanwhile) stays; a new publication clears old ones itself.
    const view = () => { setProgress(null); setEditing(false); reread(value => value + 1) }
    // A confirmed publication returns to the read page at once (F19): "Published" is shown over the note, not the editor.
    const report = useCallback((next: PublishProgress | null) => { setProgress(next); if (next?.step === 'done' && next.kind === 'publish') setEditing(false) }, [])
    const basis = live.note && !live.note.deleted && live.note.body ? { revision: live.note.stateRevision, title: publicText(live.note.title, true), body: publicText(live.note.body) } : null
    function actions(draft: DraftRecord, editor: EditorActions): { primary?: ReactNode; banner?: ReactNode } {
        if (live.note === undefined) return {
            primary: <button type="button" className="os-btn" disabled>Publish</button>,
            banner: live.failed ? <NoteBanner notice={{ tone: 'warn', text: 'The published note could not be checked.', actions: <button className="os-btn os-quiet" onClick={recheckLive}>Check again</button> }} /> : undefined,
        }
        const note = live.note, exists = !!note && !note.deleted
        const base = draft.payload.kind === 'public' ? draft.payload.base : undefined
        // Only a strictly newer revision is news; a lagging older answer is never offered as an update.
        const behind = exists && (!base || BigInt(note.stateRevision) > BigInt(base.stateRevision))
        if (conflict) return {
            primary: <button type="button" className="os-btn" disabled>Choose a version to publish</button>,
            banner: <RebaseConflict key={conflict.latest.stateRevision} plan={conflict} draft={draft} store={store} published={editor.published} onResolved={moved} />,
        }
        return {
            // A draft without a baseline is a creation: never offer it for a note that already exists.
            primary: (base || !exists) && <PublicPublish draft={draft} client={client} store={store} requestSession={session} walletChainId={walletChainId} privateCreate={base ? undefined : privateCreate}
                onPrivatePublished={() => reread(value => value + 1)}
                beforeReview={base ? () => update(draft, true) : undefined} titleProblem={editor.titleProblem} onNotice={setNotice} onProgress={report}
                onPublished={confirmed => {
                    void editor.published(draftBase(confirmed), draft.localRevision).then(done => { if (!done) setNotice(info(`Published as revision ${confirmed.stateRevision}. Your draft changed meanwhile; it is updated to the latest revision before your next publication.`)) },
                        () => setNotice(info(`Published as revision ${confirmed.stateRevision}. This device did not confirm the draft update; your text is kept.`)))
                    reread(value => value + 1)
                }} />,
            banner: behind && <NoteBanner notice={{ tone: 'info', text: base ? `Revision ${note.stateRevision} was published while you were editing (you started from revision ${base.stateRevision}).` : `This note is already published (revision ${note.stateRevision}).`,
                actions: <button className="os-btn" disabled={checking} onClick={() => void update(draft)}>Bring in revision {note.stateRevision}</button> }} />,
        }
    }
    // Newer text published by someone else is never called this device's unpublished changes (F21).
    const changes = (note: ChainNote) => !saved || (!note.deleted && sameText(saved, note)) ? undefined
        : note.deleted ? <NoteStatus kind="draft">Draft on this device</NoteStatus>
        : saved.base && BigInt(note.stateRevision) > BigInt(saved.base.stateRevision) ? <NoteStatus kind="draft">Draft on this device · based on revision {saved.base.stateRevision}</NoteStatus>
        : <NoteStatus kind="changes">Unpublished changes{saved.base ? ` · based on revision ${saved.base.stateRevision}` : ''}</NoteStatus>
    // A confirmed private publication replaces its plaintext draft with an encrypted one; a plaintext copy left over
    // (the draft changed meanwhile, or an earlier version) is named here and can be removed. The private page reports here.
    const unencrypted = encrypted && ((note: ChainNote, refresh: () => void) => <>
        {saved && !note.deleted && <NoteBanner notice={{ tone: 'warn', text: 'An unencrypted copy of this note’s text is still on this device, from before it was published privately.',
            actions: <button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => void discardBehind('Remove the unencrypted copy of this note from this device? The private note on the network does not change.')}>Remove this copy</button> }} />}
        <NoteBanner notice={notice} />
        {encrypted(note, refresh, { onProgress: report, onNotice: setNotice, requestSession: session })}</>)
    if (start === 'checking') return <NoteSkeleton />
    return <div className="os-notes-authoring">
        {!editing && saved && (unread || (opened && live.failed)) && <NoteBanner notice={{ tone: 'warn', text: 'The published note could not be read. Your draft on this device is kept; publishing checks the network again.',
            actions: <button type="button" className="os-btn" disabled={busy} onClick={() => opened ? setEditing(true) : void prepare()}>Open my draft</button> }} />}
        <div hidden={editing}>
            <PublicNote id={scope.noteId} client={client} owner={scope.owner} status={changes} encrypted={unencrypted}
                banner={!editing && <><NoteBanner notice={notice} />{behind && ('deleted' in behind
                    ? <NoteBanner notice={{ tone: 'info', text: 'This note was deleted. Your draft of it is still on this device.',
                        actions: <><button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => void prepare()}>Open my draft</button>
                            <button type="button" className="os-btn" disabled={busy} onClick={() => void discardBehind('Remove your draft of this deleted note from this device? Export it first if you want to keep the text.')}>Remove my draft</button></> }} />
                    : <NoteBanner notice={{ tone: 'info', text: `Your draft on this device is based on revision ${behind.base} — revision ${behind.latest} is published.`,
                        actions: <><button type="button" className="os-btn" disabled={busy} onClick={() => void prepare()}>Open my draft</button>
                            <button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => void discardBehind(`Discard your draft on this device? It is based on revision ${behind.base}; the published note does not change.`)}>Discard</button></> }} />)}</>}
                primary={note => !editing && <PublicEditButton note={note} owner={scope.owner} client={client} busy={busy} onEdit={() => opened ? setEditing(true) : void prepare()} />}
                /* A confirmed change announces the note's new revision, which re-reads this reader. */
                share={note => !editing && <NoteSharePopover note={note} client={client} store={store} owner={scope.owner} onChanged={settled} />}
                menu={note => note.owner === scope.owner ? [{ label: 'Delete note…', danger: true, run: () => setDeleting(note) }] : []}>
                {(note, _refresh, previewRoot) => note.mode >= 3 && <NoteSidePanel note={note} client={client} owner={scope.owner} store={store} previewRoot={previewRoot}
                    hidden={editing} onRestore={draft => prepare(draft)} />}
            </PublicNote>
        </div>
        {opened && <div hidden={!editing}>
            <DraftEditor key={generation} scope={scope} store={store} onSaved={() => reread(value => value + 1)} basis={basis} banner={editing && <NoteBanner notice={notice} />}
                onCancel={basis || saved?.base ? cancel : undefined} actions={editing ? actions : undefined} />
        </div>}
        {progress && <PublishProgressSheet progress={progress} onHide={() => setProgress(null)} onView={view} />}
        {deleting && <PublicDelete note={deleting} client={client} store={store} owner={scope.owner} title={publicText(deleting.title, true)} requestSession={session} walletChainId={walletChainId} onClose={() => setDeleting(null)} onNotice={setNotice} onProgress={setProgress} />}
    </div>
}

/** The draft's overlapping lines, named in the banner (F25): at most three, each clipped. */
function overlapText(lines: ConflictLine[]): string {
    const clip = (text: string) => !text.trim() ? '(empty)' : `“${[...text].length > 40 ? `${[...text].slice(0, 39).join('')}…` : text}”`
    const named = lines.slice(0, 3).map(({ line, text }) => text === null ? `${line} (removed)` : `${line} ${clip(text)}`)
    return named.length ? `: your line${lines.length > 1 ? 's' : ''} ${named.join(', ')}${lines.length > 3 ? ` and ${lines.length - 3} more` : ''}` : ''
}
/**
 * Overlap: the user's text stays untouched until they choose, after seeing the other version.
 * Rendered with the editor's saved snapshot, so a choice never races unsaved typing.
 */
function RebaseConflict({ plan, draft, store, published, onResolved }: {
    plan: Conflict; draft: DraftRecord; store: NotesStore
    published(base: DraftBase, fromRevision: string): Promise<boolean>; onResolved(message: Notice | null, reload?: boolean): void
}) {
    const latest = plan.latest, revision = latest.stateRevision, owner = draft.scope.owner
    const [session] = useState(createDraftSession), working = useRef(false)
    const [seen, setSeen] = useState(false), [busy, setBusy] = useState(false), [problem, setProblem] = useState('')
    useLayoutEffect(() => () => session.invalidate(), [session])
    if (draft.payload.kind !== 'public') return null
    const mine = draft.payload
    const fields = plan.fields.length === 2 ? 'the title and the text' : plan.fields[0] === 'title' ? 'the title' : 'the same lines'
    const who = latest.actor === owner ? 'you, from another window or device' : shortAddress(latest.actor)
    async function choose(keepMine: boolean) {
        if (working.current) return
        working.current = true; setBusy(true); setProblem('')
        const guard = session.capture()
        try {
            if (keepMine) {
                // The editor keeps its text and only moves its baseline; storage gets a bounded time to answer.
                if (!await withTimeout(published(draftBase(latest), draft.localRevision))) { if (!guard.signal.aborted) setProblem('Your draft changed in another window. Nothing was replaced.'); return }
                onResolved(info(`Your version now follows revision ${revision}. Publishing it replaces their change, so read it once more first.`), false)
                return
            }
            // Told apart from the note in the list, and its page says where it came from (F26).
            const copy = await saveDraftBounded(store, { ...draft.scope, noteId: newNoteId() }, '0', { kind: 'public', title: copyTitle(mine.title), body: mine.body, copyOf: { noteId: draft.scope.noteId, title: plan.theirs.title } }, guard)
            if (guard.signal.aborted) return
            if (copy.status !== 'saved') { setProblem('Your text could not be saved as a separate draft, so nothing was replaced. Export it or try again.'); return }
            const result = await saveDraftBounded(store, draft.scope, draft.localRevision, { kind: 'public', ...plan.theirs, base: draftBase(latest) }, guard)
            if (guard.signal.aborted) return
            if (result.status !== 'saved') { setProblem('Your draft changed in another window. Nothing was replaced; your text was also saved as a separate draft.'); return }
            onResolved(info(`Editing revision ${revision}. Your previous text was saved as a separate note on this device.`))
        } catch (error) {
            if (!guard.signal.aborted) setProblem(error instanceof NotesTimeoutError ? `This device did not answer in time. Nothing was replaced. ${kept}`
                : error instanceof DraftWriteUnknownError ? 'This device did not confirm whether your draft was updated. Your text is still in the editor.' : `Your draft could not be updated. Nothing was replaced. ${kept}`)
        } finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    // differingLines(mine, theirs): each column shows its own side of the overlap.
    const lines = differingLines(mine.body, plan.theirs.body), titles = plan.fields.includes('title')
    return <div className="os-notes-conflict">
        <NoteBanner notice={{ tone: 'warn', title: 'Someone published a newer version', text: `(revision ${revision} by ${who}) that changes ${fields} as you${overlapText(plan.lines ?? [])}. ${kept} Choose which version to publish.`,
            actions: !seen && <button className="os-btn" onClick={() => setSeen(true)}>See changes</button> }} />
        {seen && <section className="os-notes-chooser" aria-label="Choose a version">
            <div className="os-notes-version">
                <h4>Revision {revision} · {latest.actor === owner ? 'you' : shortAddress(latest.actor)}</h4>
                {titles && <p className="os-notes-version-title">{plan.theirs.title}</p>}
                {plan.fields.includes('body') && <pre data-side="theirs">{lines.theirs.join('\n') || '(lines removed)'}</pre>}
                <button className="os-btn os-quiet" disabled={busy} onClick={() => void choose(false)}>Use this version</button>
            </div>
            <div className="os-notes-version">
                <h4>Your version</h4>
                {titles && <p className="os-notes-version-title">{mine.title}</p>}
                {plan.fields.includes('body') && <pre data-side="mine">{lines.mine.join('\n') || '(lines removed)'}</pre>}
                <button className="os-btn os-quiet" disabled={busy} onClick={() => void choose(true)}>Use my version</button>
            </div>
            <p className="os-notes-hint">“Use this version” keeps your text as a separate note on this device. You can edit by hand after choosing; nothing is published until you press Publish.</p>
            {problem && <p className="os-notes-field-error" role="alert">{problem}</p>}
        </section>}
    </div>
}
