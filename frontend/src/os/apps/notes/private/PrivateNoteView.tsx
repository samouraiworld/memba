import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { NotesChainError, type ChainNote } from '../../../../lib/notes/chain/schema'
import { createDraftSession, type NotesStore } from '../../../../lib/notes/drafts'
import { withTimeout } from '../../../../lib/notes/freshness'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { privateNotesDeployment } from '../../../../lib/notes/config'
import { parseWrap, PrivateNoteNoAccess, readEncryptedNote } from '../../../../lib/notes/private'
import { MarkdownPreview } from '../MarkdownPreview'
import { NoteHeader, NoteStatus, type NoteMenuItem } from '../NoteHeader'
import type { NoteReport } from '../PublicPublish'
import { NoteSkeleton } from '../PublicNote'
import { shortAddress } from '../notesFormat'
import { RecoverySheet } from './PrivateNotesPanel'
import { adenaWallet, unlockProblem } from './unlock'
import { withKey } from './keyQueue'
import { PrivateDraftEditor } from './PrivateDraftEditor'
import { PrivateDelete } from './PrivateDelete'
import './notes-private.css'

export interface PrivateNoteViewProps {
    note: ChainNote; controller: NotesIdentityController; client: NotesReadClient; owner: string; walletChainId?: string
    /** This device's drafts: an owner or writer edits here, encrypted; the owner deletes the note. Without it, read only. */
    store?: NotesStore; report?: NoteReport
}
/** Whether this account holds an envelope in the note's current epoch: a public read, before any key or wallet. */
type Access = { note: string; epoch: string; generation: string | null; writer: boolean } | { note: string; epoch: string; none: true } | { note: string; epoch: string; failed: true }
type Opened = { note: string; revision: string; title: string; body: string; exposed: boolean }
type Problem = { note: string; revision: string; kind: 'other-key' | 'failed' }

/** A private note in the Notes reader: locked, unlocked (read only), or not shared with this account. */
export function PrivateNoteView(props: PrivateNoteViewProps) {
    const { note, client } = props
    // The gate closed under an open window: the plain placeholder, never a prompt.
    if (privateNotesDeployment(client.chainId)?.realm !== client.realm) return <section className="os-notes-document os-notes-reader" aria-label="Private note">
        <NoteHeader noteId={note.id} status={<NoteStatus kind="private">Private · revision {note.stateRevision}</NoteStatus>} /><p className="os-notes-hint">This private note is encrypted. Opening private notes is not available in this version.</p></section>
    return <View {...props} />
}
function View({ note, controller, client, owner, walletChainId, store, report }: PrivateNoteViewProps) {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const { phase, generation } = state, chainId = client.chainId
    const [access, setAccess] = useState<Access | null>(null), [opened, setOpened] = useState<Opened | null>(null), [problem, setProblem] = useState<Problem | null>(null)
    const [attempt, retry] = useState(0), [working, setWorking] = useState(false), [notice, setNotice] = useState(''), [recover, setRecover] = useState(false)
    // Editing survives a lock (the editor stores its text encrypted and unmounts); Unlock reopens it.
    const [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false), [draft, setDraft] = useState<string | null>(null), [drafts, reread] = useState(0)
    const scope = { chainId, realm: client.realm, owner, noteId: note.id }
    // Whether this device holds a draft of the note (no decryption): the status says so and the menu offers to remove it.
    useEffect(() => {
        let alive = true
        if (store) void withTimeout(store.getDraft({ chainId, realm: client.realm, owner, noteId: note.id })).then(record => { if (alive) setDraft(record?.payload.kind === 'encrypted' ? record.localRevision : null) }, () => {})
        return () => { alive = false }
    }, [store, chainId, client.realm, owner, note.id, note.stateRevision, editing, phase, drafts])
    // The key's state on this network (no wallet). Panels of the same window share the controller.
    useEffect(() => { if (controller.getSnapshot().phase === 'unknown') void withKey(controller, () => controller.refresh()).catch(() => {}) }, [controller])
    useEffect(() => {
        let alive = true
        void Promise.resolve().then(() => client.wrapRaw(note.id, note.epoch, owner)).then(raw => {
            if (!alive) return
            setAccess(raw === null ? { note: note.id, epoch: note.epoch, none: true } : { note: note.id, epoch: note.epoch, ...(({ generation, writer }) => ({ generation, writer }))(parseWrap(raw, note.epoch, owner)) })
        }).catch(() => { if (alive) setAccess({ note: note.id, epoch: note.epoch, failed: true }) })
        return () => { alive = false }
    }, [client, note.id, note.epoch, owner, attempt])
    const known = access && access.note === note.id && access.epoch === note.epoch ? access : null
    const readable = !!known && 'generation' in known && known.generation === generation
    // Decrypted only while unlocked; a lock (Lock, Shell lock, account or network switch, page hide) clears it.
    useEffect(() => {
        // The previous run's cleanup already dropped what it decrypted.
        if (phase !== 'unlocked' || !readable) return
        const lifetime = new AbortController()
        void withKey(controller, () => readEncryptedNote(client, note.id, { access: { kind: 'identity', owner, identity: controller }, signal: lifetime.signal })).then(view => {
            try {
                const text = view.text()
                if (!lifetime.signal.aborted) { setProblem(null); setOpened({ note: view.note.id, revision: view.note.stateRevision, ...text, exposed: view.exposed }) }
            } finally { view.dispose() }
        }).catch(error => {
            if (lifetime.signal.aborted || (error instanceof NotesChainError && error.code === 'session')) return
            setProblem({ note: note.id, revision: note.stateRevision, kind: error instanceof PrivateNoteNoAccess ? 'other-key' : 'failed' })
        })
        return () => { lifetime.abort(); setOpened(null) }
    }, [phase, readable, controller, client, note.id, note.stateRevision, owner, attempt])
    const walletProblem = walletChainId && walletChainId !== chainId ? `Adena is on ${walletChainId}. Switch it to ${chainId} first.` : ''
    async function unlock() {
        setNotice(''); setWorking(true)
        try { await withKey(controller, () => controller.unlockStandard(adenaWallet())) } catch (error) { setNotice(unlockProblem(error)) } finally { setWorking(false) }
    }
    const shown = phase === 'unlocked' && opened?.note === note.id ? opened : null
    const writable = !!store && !!known && 'writer' in known && (known.writer || note.owner === owner) && !shown?.exposed
    if (editing && shown && writable && store) return <PrivateDraftEditor key={`${generation}:${note.stateRevision}`} store={store} client={client} controller={controller} owner={owner} walletChainId={walletChainId}
        note={note} published={{ title: shown.title, body: shown.body }} report={report} onClose={() => setEditing(false)}
        onUnsaved={() => setNotice('Your last edits could not be stored encrypted on this device (another window changed the draft, storage refused, or private notes closed). The previous encrypted save is kept; nothing was stored unencrypted.')} />
    /** Removes this device's encrypted draft at the revision read before asking (compare-and-swap), without decrypting it. */
    async function removeDraft() {
        const revision = draft
        if (!store || !revision || !window.confirm('Remove your encrypted draft of this note from this device? Unpublished changes in it are lost; the note on the network does not change.')) return
        const result = await store.deleteDraft(scope, revision, createDraftSession()).catch(() => null)
        setNotice(result?.status === 'saved' ? 'Your draft was removed from this device.' : 'Your draft changed in another window or could not be removed, so it was kept.'); reread(n => n + 1)
    }
    const failed = problem && problem.note === note.id && problem.revision === note.stateRevision ? problem.kind : null
    const message = (title: string, text: string, actions?: ReactNode) => <div className="os-notes-private-state"><p><b>{title}</b> {text}</p>{actions && <div className="os-notes-private-actions">{actions}</div>}</div>
    let body: ReactNode
    if (known && 'none' in known) body = message('You don’t have access to this private note.', 'Only its owner and the people it is shared with can read it.')
    else if (known && 'failed' in known) body = message('This private note could not be checked.', 'Nothing was changed.', <button type="button" className="os-btn" onClick={() => retry(n => n + 1)}>Try again</button>)
    else if (!known || phase === 'unknown') body = <NoteSkeleton label="Checking your access…" />
    else if (failed === 'other-key' || (phase !== 'empty' && known.generation !== generation)) body = message('Your current key cannot open this note.', 'It was shared with another private key of this account. Memba changed nothing.')
    else if (phase === 'empty' || phase === 'revoked' || phase === 'prepared') body = message('You don’t have access to this private note.', phase === 'revoked' ? 'Your private key was turned off outside Memba.' : 'Set up private notes first, in Private notes.')
    else if (phase === 'locked' && !state.mode) body = message('Your private key cannot be unlocked in Memba.', 'It was registered outside Memba, and Notes holds no backup of it.')
    else if (phase === 'locked') body = <div className="os-notes-private-state">
        {editing && <p>Your edits are saved encrypted on this device. Unlock to continue editing.</p>}
        <p><b>This note is encrypted.</b> {state.mode === 'standard' ? 'Unlock your private key to read it: Adena signs a fixed message. It is not a transaction and costs nothing. Sign it only on memba.club.' : 'Unlock your private key with your recovery phrase to read it.'}</p>
        {walletProblem && state.mode === 'standard' && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
        <div className="os-notes-private-actions">
            {state.mode === 'standard' && <button type="button" className="os-btn" disabled={working || state.busy || !!walletProblem} onClick={() => void unlock()}>{working ? 'Waiting for Adena…' : 'Unlock'}</button>}
            <button type="button" className={state.mode === 'standard' ? 'os-btn os-quiet' : 'os-btn'} disabled={working} onClick={() => setRecover(true)}>Use recovery phrase</button>
        </div></div>
    else if (failed === 'failed') body = message('This private note could not be opened.', 'Nothing was changed.', <button type="button" className="os-btn" onClick={() => retry(n => n + 1)}>Try again</button>)
    else if (!shown) body = <NoteSkeleton label="Decrypting…" />
    else body = <>
        <h1 className="os-notes-title">{shown.title}</h1>
        <p className="os-notes-hint">Encrypted · only its owner and the people it is shared with can read it{shown.exposed ? ' · its key for this version was made public' : ''}</p>
        <MarkdownPreview key={note.id} body={shown.body} noteId={note.id} />
    </>
    const by = note.actor === owner ? 'you' : shortAddress(note.actor)
    const menu: NoteMenuItem[] = [...store && note.owner === owner ? [{ label: 'Delete note…', danger: true, run: () => setDeleting(true) }] : [],
        ...store && draft ? [{ label: 'Remove my draft on this device…', run: () => void removeDraft() }] : []]
    return <section className="os-notes-document os-notes-reader os-notes-private-note" aria-label="Private note">
        <NoteHeader noteId={note.id} status={<NoteStatus kind="private">Private · revision {note.stateRevision} · by {by}{draft ? ' · draft on this device' : ''}</NoteStatus>} menu={menu}
            actions={phase === 'unlocked' && <button type="button" className="os-btn os-quiet" onClick={() => controller.lock()}>Lock</button>}
            primary={shown && writable && <button type="button" className="os-btn" onClick={() => setEditing(true)}>Edit</button>} />
        {body}
        {notice && <p className="os-notes-private-notice" role="status">{notice}</p>}
        {deleting && store && <PrivateDelete note={note} client={client} store={store} owner={owner} walletChainId={walletChainId} report={report} onClose={() => setDeleting(false)} />}
        {recover && <RecoverySheet controller={controller} fileNeeded={state.mode === 'standard'} onClose={() => setRecover(false)} />}
    </section>
}
