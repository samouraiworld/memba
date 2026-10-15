import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { NotesChainError, type ChainNote } from '../../../../lib/notes/chain/schema'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { privateNotesDeployment } from '../../../../lib/notes/config'
import { parseWrap, PrivateNoteNoAccess, readEncryptedNote } from '../../../../lib/notes/private'
import { MarkdownPreview } from '../MarkdownPreview'
import { NoteHeader, NoteStatus } from '../NoteHeader'
import { NoteSkeleton } from '../PublicNote'
import { shortAddress } from '../notesFormat'
import { RecoverySheet } from './PrivateNotesPanel'
import { adenaWallet, unlockProblem } from './unlock'
import { withKey } from './keyQueue'
import './notes-private.css'

export interface PrivateNoteViewProps {
    note: ChainNote; controller: NotesIdentityController; client: NotesReadClient; owner: string; walletChainId?: string
}
/** Whether this account holds an envelope in the note's current epoch: a public read, before any key or wallet. */
type Access = { note: string; epoch: string; generation: string | null } | { note: string; epoch: string; none: true } | { note: string; epoch: string; failed: true }
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
function View({ note, controller, client, owner, walletChainId }: PrivateNoteViewProps) {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const { phase, generation } = state, chainId = client.chainId
    const [access, setAccess] = useState<Access | null>(null), [opened, setOpened] = useState<Opened | null>(null), [problem, setProblem] = useState<Problem | null>(null)
    const [attempt, retry] = useState(0), [working, setWorking] = useState(false), [notice, setNotice] = useState(''), [recover, setRecover] = useState(false)
    // The key's state on this network (no wallet). Panels of the same window share the controller.
    useEffect(() => { if (controller.getSnapshot().phase === 'unknown') void withKey(controller, () => controller.refresh()).catch(() => {}) }, [controller])
    useEffect(() => {
        let alive = true
        void Promise.resolve().then(() => client.wrapRaw(note.id, note.epoch, owner)).then(raw => {
            if (!alive) return
            setAccess(raw === null ? { note: note.id, epoch: note.epoch, none: true } : { note: note.id, epoch: note.epoch, generation: parseWrap(raw, note.epoch, owner).generation })
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
    return <section className="os-notes-document os-notes-reader os-notes-private-note" aria-label="Private note">
        <NoteHeader noteId={note.id} status={<NoteStatus kind="private">Private · revision {note.stateRevision} · by {by}</NoteStatus>}
            primary={phase === 'unlocked' && <button type="button" className="os-btn os-quiet" onClick={() => controller.lock()}>Lock</button>} />
        {body}
        {notice && <p className="os-notes-private-notice" role="status">{notice}</p>}
        {recover && <RecoverySheet controller={controller} fileNeeded={state.mode === 'standard'} onClose={() => setRecover(false)} />}
    </section>
}
