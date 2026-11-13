import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { draftBase } from '../../../../lib/notes/chain/draftOperation'
import { gnotAmount } from '../../../../lib/notes/chain/quote'
import { NotesChainError, type ChainNote } from '../../../../lib/notes/chain/schema'
import { MAX_NOTE_BODY_BYTES, newNoteId, notesDeployment } from '../../../../lib/notes/config'
import { equalBytes } from '../../../../lib/notes/crypto/bytes'
import { trackDraftFlush } from '../../../../lib/notes/draftFlush'
import { readDraftSlot, saveDraftBounded } from '../../../../lib/notes/draftSlot'
import { createDraftSession, type DraftBase, type NotesStore } from '../../../../lib/notes/drafts'
import { NotesTimeoutError, withTimeout } from '../../../../lib/notes/freshness'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { NotesIntents } from '../../../../lib/notes/intents'
import { MAX_PUBLIC_TITLE_BYTES, MAX_PUBLIC_TITLE_CHARACTERS, publicTitleProblem, trimPublicTitle } from '../../../../lib/notes/publicFields'
import { openPrivateDraft, parseEpochPage, preparePrivateNoteRequest, PrivateNoteNoAccess, PrivateStorageAboveCap, privateNoteBudget, privateNoteMessage, privateNoteQuote,
    readPrivateAccess, sealEncryptedChanges, sealPrivateDraft, type PrivateCommitSizes, type PrivateNoteOperation } from '../../../../lib/notes/private'
import { freshFeeForGasWanted } from '../../../../lib/grc20'
import { useSigner } from '../../../sign/signerContext'
import { CodeEditor } from '../../terminal/CodeEditor'
import { MarkdownPreview } from '../MarkdownPreview'
import { NoteBanner, NoteHeader, NoteSheet, NoteStatus } from '../NoteHeader'
import { mayLockPrivateNotes, useNotesPane, useUnsavedText } from '../notesPane'
import { balanceOf, downloadMarkdown, readPreviewChoice, writePreviewChoice } from '../notesFormat'
import { PRIVATE_TITLE, sign, type NoteReport } from '../PublicPublish'
import { afterConfirmed, privateOpen, sealConfirmedDraft, type DraftKey } from './encryptedDraft'
import { withKey } from './keyQueue'

type Text = { title: string; body: string }
/** The baseline of a creation draft: the note as its first publication wrote it. */
const CREATED: DraftBase = { stateRevision: '1', epoch: '1', ownerGeneration: '1', titleRevision: '1', bodyRevision: '1' }
type Opened = { revision: string; key: DraftKey; base: DraftBase; mode: 0 | 1 | 2 }
type State = 'loading' | 'saved' | 'dirty' | 'saving' | 'conflict' | 'unavailable' | 'failed'
export interface PrivateEditorProps {
    store: NotesStore; client: NotesReadClient; controller: NotesIdentityController; owner: string; walletChainId?: string
    /** The private note as read, and its decrypted text: the draft starts from it and Publish compares with it. */
    note: ChainNote; published: Text; report?: NoteReport; onClose(): void
    /** The edits stored at unmount (a lock) could not be saved: the page says so, since this editor is gone. */
    onUnsaved?(): void
}
/**
 * Editing a private note, rendered only while the key is unlocked. The text is kept on this device encrypted for the
 * account's registered key (a fresh data key per save, compare-and-swap on the local revision); only its public half is
 * needed to save, so a lock (which unmounts this editor) still stores the last edits encrypted, then drops the plaintext.
 */
export function PrivateDraftEditor({ store, client, controller, owner, walletChainId, note, published, report, onClose, onUnsaved }: PrivateEditorProps) {
    const scope = useMemo(() => ({ chainId: client.chainId, realm: client.realm, owner, noteId: note.id }), [client, owner, note.id])
    const [session] = useState(createDraftSession), [keep] = useState(createDraftSession), pane = useNotesPane(), descriptionId = useId()
    const [text, setText] = useState<Text | null>(null), [state, setState] = useState<State>('loading'), [reload, setReload] = useState(0)
    const [behind, setBehind] = useState<string | null>(null), [notice, setNotice] = useState(''), [preview, setPreview] = useState(readPreviewChoice), [review, setReview] = useState<{ revision: string; key: DraftKey; text: Text } | null>(null)
    const opened = useRef<Opened | null>(null), draft = useRef({ title: '', body: '', changes: 0 }), stored = useRef(0), running = useRef<Promise<unknown>>(Promise.resolve())
    useUnsavedText(state === 'conflict' || state === 'unavailable', 'This private note has edits that could not be saved on this device. Leave without saving them? Choose Cancel to keep editing.',
        'This private note has edits that could not be saved encrypted on this device, and locking discards them. Lock anyway? Choose Cancel to keep editing.')
    const sealed = (o: Opened, value: Text) => ({ kind: 'encrypted' as const, envelope: sealPrivateDraft(scope, BigInt(o.revision) + 1n, BigInt(o.key.generation), o.key.publicKey, { ...value, mode: o.mode, base: o.base }) })
    /** Saves the latest text once the running save settled; `keep` is never aborted, so a lock or unmount still lands it. */
    function save(): Promise<boolean> {
        const run = running.current.then(async () => {
            const o = opened.current, snapshot = { ...draft.current }
            if (!o || snapshot.changes === stored.current) return true
            // Closed private notes save nothing: the edits since the last save are dropped, never stored unencrypted.
            if (!privateOpen(client)) { setState('unavailable'); return false }
            setState('saving')
            const result = await store.saveDraft(scope, o.revision, sealed(o, snapshot), keep)
            if (result.status === 'saved') {
                o.revision = result.value.localRevision; stored.current = snapshot.changes
                setState(draft.current.changes === snapshot.changes ? 'saved' : 'dirty'); pane?.saved(); return true
            }
            setState(result.status === 'conflict' ? 'conflict' : 'unavailable'); return false
        })
        running.current = run.catch(() => false); return run
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Unmount (lock, Cancel, another note): the edits are stored encrypted first.
    useLayoutEffect(() => () => { session.invalidate(); trackDraftFlush(scope, save().then(ok => { if (!ok) onUnsaved?.() }, () => onUnsaved?.())) }, [])
    useEffect(() => {
        const guard = session.capture(), generation = controller.getSnapshot().generation
        void (async () => {
            if (!privateOpen(client) || !generation) throw new NotesChainError('disabled')
            const [slot, registered] = await withTimeout(Promise.all([readDraftSlot(store, scope, guard), client.key(owner)]))
            if (guard.signal.aborted) return
            if (!registered.active || registered.generation !== generation) throw new PrivateNoteNoAccess('other-key')
            const record = slot.draft?.payload.kind === 'encrypted' ? { revision: slot.draft.localRevision, envelope: slot.draft.payload.envelope } : null
            // Opened with the unlocked key, once it proves to be the registered one; a draft for another key stays as it is.
            const value = await withKey(controller, () => controller.use(identity => {
                if (!equalBytes(identity.publicKey, registered.publicKey)) throw new PrivateNoteNoAccess('other-key')
                return record && openPrivateDraft(scope, BigInt(record.revision), BigInt(generation), identity, record.envelope)
            }))
            if (guard.signal.aborted) return
            const o: Opened = { revision: slot.draft?.localRevision ?? slot.revision, key: { generation, publicKey: registered.publicKey.slice() }, base: value?.base ?? draftBase(note), mode: note.mode as 0 | 1 | 2 }
            // A plaintext copy left on this device (its replacement after publication was refused, so it may hold unpublished
            // edits) becomes the encrypted draft with its own text, never the published text in its place.
            const plain = slot.draft?.payload.kind === 'public' ? slot.draft.payload : null
            const same = (text: Text) => trimPublicTitle(text.title) === published.title && text.body === published.body
            const current: Text = value ?? (plain ? { title: plain.title, body: plain.body } : published)
            // No encrypted draft yet, or one that holds exactly the published text: it follows the note.
            if (!value || (value.base?.stateRevision !== note.stateRevision && same(value))) {
                // A copy that differs from the note keeps its own baseline (a creation draft: revision 1), so "behind" asks first.
                o.base = plain && !same(current) ? plain.base ?? CREATED : draftBase(note)
                const result = await saveDraftBounded(store, scope, o.revision, sealed(o, current), guard)
                if (guard.signal.aborted) return
                if (result.status !== 'saved') { setState(result.status === 'conflict' ? 'conflict' : 'unavailable'); return }
                o.revision = result.value.localRevision; pane?.saved()
                if (plain) setNotice(same(current) ? 'The unencrypted copy of this note on this device was replaced by an encrypted one.' : 'The unencrypted copy of this note on this device is now encrypted, with its text kept.')
            }
            opened.current = o; draft.current = { ...current, changes: 0 }; stored.current = 0
            setText(current); setBehind(o.base.stateRevision === note.stateRevision ? null : o.base.stateRevision); setState('saved')
        })().catch(() => { if (!guard.signal.aborted) setState('failed') })
        // Keyed by the note revision and key generation: a new one opens a new editor.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload])
    useEffect(() => {
        if (state !== 'dirty') return
        const timer = setTimeout(() => void save(), 600)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- save reads the latest text from its ref.
    }, [text, state])
    function edit(field: keyof Text, value: string) {
        if (field === 'title' && ([...value].length > MAX_PUBLIC_TITLE_CHARACTERS || new TextEncoder().encode(value).length > MAX_PUBLIC_TITLE_BYTES)) { setNotice(`Too long to publish: shorten it to ${MAX_PUBLIC_TITLE_CHARACTERS} characters.`); return }
        draft.current = { ...draft.current, [field]: value, changes: draft.current.changes + 1 }
        setText({ title: draft.current.title, body: draft.current.body }); setNotice('')
        if (state === 'saved') setState('dirty')
    }
    /** "Keep my text" moves the baseline to the note as published now; "Use revision N" also takes its text. */
    function rebase(text: Text | null) {
        const o = opened.current
        if (!o) return
        o.base = draftBase(note)
        if (text) { draft.current = { ...text, changes: draft.current.changes }; setText(text) }
        draft.current = { ...draft.current, changes: draft.current.changes + 1 }; setBehind(null); setState('dirty')
    }
    function togglePreview() { const next = !preview; setPreview(next); writePreviewChoice(next) }
    if (state === 'loading') return <div className="os-notes-sheet-wait" role="status"><span className="os-spin" aria-hidden="true" />Decrypting your draft…</div>
    if (state === 'failed' || !text) return <div className="os-notes-private-state">
        <p><b>This private draft could not be opened.</b> It may have been encrypted for another key of this account. It is kept as it is; Memba changed nothing.</p>
        <div className="os-notes-private-actions"><button type="button" className="os-btn os-quiet" onClick={onClose}>Back to the note</button></div></div>
    const title = trimPublicTitle(text.title), titleProblem = !title ? 'Add a title to publish.' : publicTitleProblem(text.title)
    const changed = title !== published.title || text.body !== published.body
    const saving = state === 'saved' ? 'encrypted on this device' : state === 'saving' || state === 'dirty' ? 'encrypting…' : 'edits not saved'
    return <section className="os-notes-document os-notes-editing" aria-label="Private draft editor">
        <NoteHeader noteId={note.id} status={<NoteStatus kind="private">{changed ? 'Unpublished changes' : 'No unpublished changes'} · {saving} · based on revision {behind ?? note.stateRevision}</NoteStatus>}
            actions={<>
                <button type="button" role="switch" aria-checked={preview} className="os-notes-switch" onClick={togglePreview}><span aria-hidden="true" />Preview</button>
                <button type="button" className="os-btn os-quiet" onClick={() => { if (mayLockPrivateNotes()) controller.lock() }}>Lock</button>
                <button type="button" className="os-btn os-quiet" onClick={onClose}>Done</button>
            </>}
            primary={<button type="button" className="os-btn" disabled={state !== 'saved' || !!behind || !changed || !!titleProblem} title={titleProblem ?? undefined} onClick={() => { const o = opened.current; if (o) setReview({ revision: o.revision, key: o.key, text: { title, body: text.body } }) }}>Publish</button>}
            menu={[{ label: 'Export', hint: 'Unencrypted Markdown file', run: () => downloadMarkdown(text.title, text.body) }]} />
        {behind && <NoteBanner notice={{ tone: 'warn', text: `Your private draft is based on revision ${behind}; revision ${note.stateRevision} is on the network. Choose which text to keep before publishing.`,
            actions: <><button className="os-btn" onClick={() => rebase(null)}>Keep my text</button><button className="os-btn os-quiet" onClick={() => rebase(published)}>Use revision {note.stateRevision}</button></> }} />}
        {(state === 'conflict' || state === 'unavailable') && <NoteBanner notice={{ tone: 'error', text: state === 'conflict' ? 'This private draft changed in another window. Your edits are still here but have not replaced its saved copy.' : 'This device could not save your edits encrypted. They are still here: keep this window open, or export them.',
            actions: <>{state === 'unavailable' && privateOpen(client) && <button className="os-btn" onClick={() => void save()}>Retry save</button>}
                <button className="os-btn os-quiet" onClick={() => { draft.current = { ...draft.current, changes: stored.current }; setState('loading'); setReload(v => v + 1) }}>Discard these edits and reload</button></> }} />}
        {notice && <NoteBanner notice={{ tone: 'info', text: notice }} />}
        <input className="os-notes-title" aria-label="Note title" placeholder="Title" value={text.title} maxLength={160} onChange={event => edit('title', event.target.value)} />
        <div className="os-notes-content" data-view={preview ? 'split' : 'edit'}>
            <CodeEditor value={text.body} onChange={value => edit('body', value)} onLimit={() => setNotice('The body is limited to 128 KiB. This change was not inserted.')} invalid={false} descriptionId={descriptionId} language="text" maxBytes={MAX_NOTE_BODY_BYTES} label="Markdown editor" className="os-notes-code" />
            {preview && <MarkdownPreview body={text.body} noteId={note.id} />}
        </div>
        <p id={descriptionId} className="os-notes-hint">Markdown · encrypted on this device as you type · Lock clears this text from the screen; unlock to continue · nothing is published until you press Publish</p>
        {review && <PrivateCommit {...{ store, client, controller, owner, walletChainId, note, report }} text={review.text} revision={review.revision} draftKey={review.key}
            onBack={() => setReview(null)} onSent={onClose} />}
    </section>
}

class NoChanges extends Error {}
function problemText(error: unknown): string {
    if (error instanceof PrivateStorageAboveCap) return 'These changes need more storage than Memba can approve. Nothing was sent. Your text is kept.'
    if (error instanceof NoChanges) return 'Nothing differs from the published note. Nothing was sent.'
    if (error instanceof PrivateNoteNoAccess) return 'Your unlocked key cannot write to this note. Nothing was encrypted or sent.'
    if (error instanceof NotesChainError && error.code === 'stale') return 'The note changed on the network meanwhile. Nothing was sent; your text is kept. Go back to the note and edit again.'
    if (error instanceof NotesChainError && error.code === 'disabled') return 'Private notes are not available on this network right now. Nothing was sent.'
    if (error instanceof NotesTimeoutError) return 'The network did not answer in time. Nothing was sent. Try again in a moment.'
    return 'The private changes could not be prepared. Nothing was sent. Your text is kept.'
}
type Review = { operation: PrivateNoteOperation; note: ChainNote; sizes: PrivateCommitSizes; generation: string; cap: string; estimate: string; networkFee: number | null; balance: bigint | null; title?: number; body?: number }
/** The review of a Commit: encrypted here, priced from M0 (simulation first at signing), then the OS signature sheet. */
function PrivateCommit({ store, client, controller, owner, walletChainId, note, report, text, revision, draftKey, onBack, onSent }: Omit<PrivateEditorProps, 'published' | 'onClose' | 'onUnsaved'> & {
    text: Text; revision: string; draftKey: DraftKey; onBack(): void; onSent(): void
}) {
    const signer = useSigner(), pane = useNotesPane(), [session] = useState(createDraftSession)
    const [review, setReview] = useState<Review | null>(null), [problem, setProblem] = useState(''), [working, setWorking] = useState(false)
    useEffect(() => {
        const lifetime = new AbortController(), generation = controller.getSnapshot().generation
        void (async () => {
            if (!privateOpen(client) || !generation) throw new NotesChainError('disabled')
            const fresh = await withTimeout(client.note(note.id))
            if (!fresh || fresh.deleted || fresh.mode > 2 || fresh.stateRevision !== note.stateRevision) throw new NotesChainError('stale')
            const changes = await withKey(controller, () => sealEncryptedChanges(client, fresh, text, { access: { kind: 'identity', owner, identity: controller }, signal: lifetime.signal }))
            if (!changes.title && !changes.body) throw new NoChanges()
            const [epoch, previousManifest] = await withTimeout(Promise.all([client.epochMetadataRaw(fresh.id, fresh.epoch), readPrivateAccess(client, fresh, lifetime.signal)]))
            const operation: PrivateNoteOperation = { chainId: client.chainId, caller: owner, noteId: fresh.id, operationId: newNoteId(), action: { kind: 'commit', ...changes, previousManifest } }
            const sizes = { title: fresh.title.length, body: fresh.body!.length }
            const budget = privateNoteBudget(privateNoteMessage(operation, client.realm, '0', { note: fresh, epoch: parseEpochPage(epoch, fresh.epoch) }), sizes)
            const [networkFee, balance] = await Promise.all([freshFeeForGasWanted(budget.gasWanted).catch(() => null), balanceOf(client.chainId, owner)])
            if (!lifetime.signal.aborted) setReview({ operation, note: fresh, sizes, generation, cap: budget.suggestedCapUgnot, estimate: budget.estimatedDepositUgnot, networkFee, balance, title: changes.title?.length, body: changes.body?.length })
        })().catch(error => { if (!lifetime.signal.aborted) setProblem(problemText(error)) })
        return () => lifetime.abort()
    }, [client, controller, owner, note, text])
    async function publish(current: Review) {
        if (working) return
        setWorking(true); setProblem('')
        // A lock or another key generation while the request waits refuses it before the wallet (privateSignal).
        const lease = new AbortController()
        const stop = controller.subscribe(() => { const now = controller.getSnapshot(); if (now.phase !== 'unlocked' || now.generation !== current.generation) lease.abort() })
        let confirmed: ChainNote | null = null
        try {
            const pending = preparePrivateNoteRequest({ client, operation: current.operation, reviewed: current.note, maxDepositUgnot: current.cap, draftLocalRevision: revision,
                session: report?.requestSession ?? session, intents: new NotesIntents(store), quote: privateNoteQuote(client, current.cap, current.sizes), isWriteEnabled: () => !!notesDeployment(client.chainId),
                isPrivateSessionCurrent: () => !lease.signal.aborted, privateSignal: lease.signal, onConfirmed: note => { confirmed = note } })
            const request = await withTimeout(pending).catch(error => { void pending.then(late => late.onDismissed?.(), () => {}); throw error })
            const { onSettled, onDismissed } = request
            request.onSettled = (outcome, choice) => { stop(); onSettled?.(outcome, choice) }
            request.onDismissed = () => { stop(); onDismissed?.() }
            request.sub = `“${text.title}”, encrypted in this browser.`
            // Confirmed: this device's encrypted draft follows the new revision (unless it changed meanwhile).
            afterConfirmed(request, () => confirmed ? sealConfirmedDraft(store, client, { chainId: client.chainId, realm: client.realm, owner, noteId: note.id }, revision, draftKey, text, confirmed) : Promise.resolve(false))
            const next = String(BigInt(current.note.stateRevision) + 1n)
            if (sign(request, { signer, pane, kind: 'publish', title: PRIVATE_TITLE, chainId: client.chainId, noteId: note.id, revision: next, confirmed: () => confirmed, onProgress: report?.onProgress, onNotice: report?.onNotice, encrypted: true })) onSent()
            else { stop(); setWorking(false) }
        } catch (error) { stop(); setProblem(problemText(error)); setWorking(false) }
    }
    const walletProblem = walletChainId && walletChainId !== client.chainId ? `Adena is on ${walletChainId}, this note lives on ${client.chainId}. Switch Adena to ${client.chainId} first.` : ''
    const total = review && BigInt(review.cap) + BigInt(review.networkFee ?? 0), short = !!review && total !== null && review.balance !== null && review.balance < total
    const fields = review && [review.title !== undefined && 'the title', review.body !== undefined && 'the text'].filter(Boolean).join(' and ')
    return <NoteSheet label="Publish private changes" onClose={working ? undefined : onBack}>
        <h2>Publish your changes to “{text.title}”?</h2>
        {!review && !problem && <div className="os-notes-sheet-wait" role="status"><span className="os-spin" aria-hidden="true" />Encrypting in this browser…</div>}
        {review && <dl className="os-notes-facts">
            <div><dt>What changes</dt><dd>The new version of {fields}, encrypted in this browser. Only the people who can open this note can read it.</dd></div>
            <div><dt>Public on the network</dt><dd>That revision {Number(review.note.stateRevision) + 1} exists, its encrypted sizes ({[review.title !== undefined && `title ${review.title} bytes`, review.body !== undefined && `text ${review.body} bytes`].filter(Boolean).join(', ')}) and when. Not the title or the text.</dd></div>
            <div><dt>Cost</dt><dd><strong className="os-notes-cost">≈ {gnotAmount(review.estimate)}</strong> locked as storage deposit, for the extra size only; no publication fee. The note keeps no earlier versions in its storage (earlier encrypted versions stay in chain history).
                <small>At most {gnotAmount(review.cap)}, written in the transaction. Network fee at most {review.networkFee === null ? 'what Adena shows' : gnotAmount(review.networkFee)}; Adena usually charges less.</small></dd></div>
        </dl>}
        {walletProblem && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
        {short && <p className="os-notes-field-error" role="alert"><b>This can cost up to {gnotAmount(String(total))}; your balance is {gnotAmount(String(review!.balance))}.</b> Nothing was sent. Your text is kept.</p>}
        {problem && <p className="os-notes-field-error" role="alert">{problem}</p>}
        <div className="os-notes-sheet-actions">
            <button type="button" className="os-btn os-quiet" disabled={working} onClick={onBack}>Keep editing</button>
            <button type="button" className="os-btn" disabled={!review || working || !!walletProblem || short} onClick={() => review && void publish(review)}>{working ? 'Preparing…' : 'Publish with Adena'}</button>
        </div>
    </NoteSheet>
}
