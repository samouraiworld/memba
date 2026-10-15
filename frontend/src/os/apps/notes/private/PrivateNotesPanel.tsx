import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { identityIntentStanding } from '../../../../lib/notes/identity/requestRecovery'
import { IDENTITY_ESTIMATE_UGNOT } from '../../../../lib/notes/identity/quote'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { NOTES_REGISTRY } from '../../../../lib/notes/chain/schema'
import { gnotAmount } from '../../../../lib/notes/chain/quote'
import { NotesCryptoError } from '../../../../lib/notes/crypto/bytes'
import { createDraftSession, type DraftSession, type NotesStore } from '../../../../lib/notes/drafts'
import { NotesIntents, type NotesIntent } from '../../../../lib/notes/intents'
import { privateNotesDeployment } from '../../../../lib/notes/config'
import { useSigner } from '../../../sign/signerContext'
import { NoteSheet } from '../NoteHeader'
import { PrivateKeySetup } from './PrivateKeySetup'
import './notes-private.css'

export interface PrivateNotesPanelProps {
    controller: NotesIdentityController; client: NotesReadClient; store: NotesStore; owner: string
    /** Lives as long as the controller: a signed setup is still verified after this panel closes. */
    requestSession: DraftSession; walletChainId?: string
}
/** Private notes for one account on one network: set up, unlock, lock, recover. Nothing when the gate is closed. */
export function PrivateNotesPanel(props: PrivateNotesPanelProps) {
    if (privateNotesDeployment(props.client.chainId)?.realm !== props.client.realm) return null
    return <Panel {...props} />
}
type Problem = 'read' | 'changed' | null
/** Adena, for the unlock signatures: read at the click, never on load. */
const adenaWallet = (): unknown => (window as unknown as { adena?: unknown }).adena
function unlockProblem(error: unknown): string {
    if (error instanceof NotesCryptoError && error.code === 'wallet') return 'Adena did not sign. Your key stays locked.'
    if (error instanceof NotesCryptoError && error.code === 'signature') return 'Adena\u2019s signature could not be checked. Make sure Adena is on this network with this account, then try again. Your key stays locked.'
    if (error instanceof NotesCryptoError && error.code === 'decrypt') return 'This signature does not open your key. Use your recovery phrase and file instead.'
    return 'Your key could not be unlocked. Nothing was changed. Try again.'
}
function Panel({ controller, client, store, owner, requestSession, walletChainId }: PrivateNotesPanelProps) {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const { version } = useSigner(), chainId = client.chainId
    const [session] = useState(createDraftSession)
    useLayoutEffect(() => () => session.invalidate(), [session])
    const [problem, setProblem] = useState<Problem>(null), [receipt, setReceipt] = useState<NotesIntent | null>(null), [ready, setReady] = useState(false)
    const [notice, setNotice] = useState(''), [working, setWorking] = useState(false), [sheet, setSheet] = useState<'setup' | 'recover' | null>(null), [again, checkAgain] = useState(0)
    // "Set up again" (explicit, acknowledged): earlier setups that may still land, and the one that did if it won.
    const [redo, setRedo] = useState(false), [ack, setAck] = useState(false), [firstOpen, setFirstOpen] = useState(false), [firstKey, setFirstKey] = useState<string | null>(null)
    const refresh = useCallback(async () => {
        const guard = session.capture()
        try { await controller.refresh(); if (!guard.signal.aborted) setProblem(null) }
        catch (error) {
            if (guard.signal.aborted || (error instanceof NotesCryptoError && error.code === 'busy')) return
            // The registry and this realm's backup disagree: the key changed outside Memba. Read only, never repaired here.
            setProblem(error instanceof NotesCryptoError && error.code === 'identity' ? 'changed' : 'read')
        }
    }, [controller, session])
    // Saved setup receipts are checked against the chain (no wallet, never sent again). One blocks setting up only while
    // it can still take effect (identityIntentStanding); one that provably never applied is settled as failed.
    useEffect(() => {
        const guard = session.capture(), intents = new NotesIntents(store)
        void (async () => {
            let open: NotesIntent | null = null, failed = 0, stillOpen = false
            for (const intent of await intents.list({ chainId, realm: NOTES_REGISTRY, owner })) {
                if (intent.action !== 'identity-setup' || !['prepared', 'submitted', 'unknown'].includes(intent.phase)) continue
                // Superseded receipts are still checked against the chain; they only stop blocking.
                const standing = await identityIntentStanding(client, intents, intent, session)
                if (standing === 'failed') failed++
                if (standing === 'pending') { if (intent.superseded) stillOpen = true; else open ??= intent }
            }
            const won = (await intents.list({ chainId, realm: NOTES_REGISTRY, owner })).find(intent => intent.superseded && intent.phase === 'confirmed')
            setFirstOpen(stillOpen); setFirstKey(won?.resultingStateRevision ?? null)
            // Settled once, said once, even when this run was superseded meanwhile (a later run finds it already failed).
            if (failed) setNotice('An earlier key setup from this device did not take effect on the network. Its receipt was kept.')
            if (guard.signal.aborted) return
            setReceipt(open); if (!open) { setRedo(false); setAck(false) }
            if (!open && controller.getSnapshot().phase === 'prepared') await controller.confirmSetup().catch(() => false)
            await refresh()
        })().catch(() => { if (!guard.signal.aborted) setProblem('read') }).finally(() => { if (!guard.signal.aborted) setReady(true) })
    }, [session, store, client, chainId, owner, controller, refresh, version, again])
    const heading = useRef<HTMLHeadingElement>(null)
    const busy = working || state.busy
    const walletProblem = walletChainId && walletChainId !== chainId ? `Adena is on ${walletChainId}. Switch it to ${chainId} first.` : ''
    async function act(work: () => Promise<void>, done: string, failed: (error: unknown) => string) {
        const guard = session.capture(); setNotice(''); setWorking(true)
        try { await work(); if (!guard.signal.aborted) setNotice(done) }
        catch (error) { if (!guard.signal.aborted) setNotice(failed(error)) }
        finally { if (!guard.signal.aborted) setWorking(false) }
    }
    /** Only while the receipt can still apply, and only after the acknowledgement: never the same operation ID again. */
    async function setUpAgain(intent: NotesIntent) {
        const guard = session.capture(); setWorking(true); setNotice('')
        try {
            const saved = await new NotesIntents(store).supersede(intent.scope, intent.operationId, guard)
            if (guard.signal.aborted) return
            if (saved.status !== 'saved') { setNotice('This device could not record your choice, so nothing changed. Check again first.'); checkAgain(n => n + 1); return }
            setRedo(false); setAck(false); setReceipt(null); setFirstOpen(true); setSheet('setup')
        } catch { if (!guard.signal.aborted) setNotice('This device could not record your choice, so nothing changed.') }
        finally { if (!guard.signal.aborted) setWorking(false) }
    }
    const unlock = () => void act(() => controller.unlockStandard(adenaWallet()), 'Unlocked in this window.', unlockProblem)
    const lock = () => { controller.lock(); setNotice('Locked. Your key was cleared from this window.') }
    let body: ReactNode
    if (!ready || (state.phase === 'unknown' && !problem)) body = <p className="os-notes-sheet-wait"><span className="os-spin" aria-hidden="true" />Checking your private key on {chainId}…</p>
    else if (problem === 'changed') body = <>
        <p><b>Your private key changed outside Memba.</b> The key registered for this account no longer matches its backup in Notes, so Memba stopped using it and changed nothing.</p>
        <p>Private notes encrypted for the earlier key stay on the network. Memba does not replace keys on its own.</p>
        <div className="os-notes-private-actions"><button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => checkAgain(n => n + 1)}>Check again</button></div></>
    else if (state.phase === 'unlocked') body = <>
        <p><b>Unlocked in this window.</b> It locks again when you press Lock, switch account or network, lock Memba, or close this window.</p>
        <div className="os-notes-private-actions"><button type="button" className="os-btn" onClick={lock}>Lock</button></div></>
    // A receipt never hides a usable key: Unlock stays reachable (the receipt is still checked each time).
    else if (receipt && !(state.phase === 'locked' && state.mode)) body = <>
        <p><b>{receipt.phase === 'submitted' ? 'Your key setup was sent.' : 'The result of your key setup is not known yet.'}</b> {receipt.phase === 'submitted'
            ? 'Memba is waiting to see it on the network; it usually appears within a minute.'
            : 'Adena may have sent it before it closed or answered, so it can still reach the network. Memba will not ask you to sign another setup on this device while that is possible, and checks the network each time you open this.'}</p>
        <p className="os-notes-hint">Operation {receipt.operationId}</p>
        <div className="os-notes-private-actions"><button type="button" className="os-btn" disabled={busy} onClick={() => checkAgain(n => n + 1)}>Check again</button>
            {!redo && <button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => setRedo(true)}>Set up again…</button>}</div>
        {redo && <div className="os-notes-private-redo">
            <p>Your first setup may still go through. If it does, this new one is refused and your first key stays yours. Keep the recovery phrase and file from your first setup until this one is confirmed.</p>
            <label><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} /> I understand, and I keep my first recovery phrase and file.</label>
            <div className="os-notes-private-actions"><button type="button" className="os-btn os-quiet" onClick={() => { setRedo(false); setAck(false) }}>Cancel</button>
                <button type="button" className="os-btn" disabled={busy || !ack} onClick={() => void setUpAgain(receipt)}>Set up again</button></div>
        </div>}</>
    else if (problem === 'read') body = <>
        <p>Memba could not read your private key from {chainId}. Nothing was changed.</p>
        <div className="os-notes-private-actions"><button type="button" className="os-btn" disabled={busy} onClick={() => checkAgain(n => n + 1)}>Try again</button></div></>
    else if (state.phase === 'empty' || state.phase === 'prepared') body = <>
        <p>Private notes are encrypted in this browser before they are sent. Only you can read them, as long as no one else gets your Adena unlock signature, or your recovery phrase and file together. Sizes and times stay visible on the network.</p>
        <p>They need a private key for this account. You set it up once; it locks about {gnotAmount(IDENTITY_ESTIMATE_UGNOT)}.</p>
        <div className="os-notes-private-actions"><button type="button" className="os-btn" disabled={busy} onClick={() => setSheet('setup')}>{state.phase === 'prepared' ? 'Continue setup' : 'Set up private notes'}</button></div></>
    else if (state.phase === 'revoked') body = <p><b>Your private key was turned off outside Memba.</b> Private notes encrypted for it stay on the network, but a turned-off key cannot open them in Memba. Memba changed nothing and does not replace keys on its own.</p>
    else if (!state.mode) body = <p><b>This account&rsquo;s private key was registered outside Memba.</b> Notes holds no backup of it, so Memba cannot unlock it. Nothing was changed.</p>
    else body = <>
        <p><b>Your private key is locked.</b> {state.mode === 'standard'
            ? 'Unlock asks Adena to sign a fixed message. It is not a transaction and costs nothing. Sign it only on memba.club.'
            : 'Unlock it with your recovery phrase.'}</p>
        {walletProblem && state.mode === 'standard' && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
        <div className="os-notes-private-actions">
            {state.mode === 'standard' && <button type="button" className="os-btn" disabled={busy || !!walletProblem} onClick={unlock}>{busy ? 'Waiting for Adena…' : 'Unlock'}</button>}
            <button type="button" className={state.mode === 'standard' ? 'os-btn os-quiet' : 'os-btn'} disabled={busy} onClick={() => setSheet('recover')}>Use recovery phrase</button>
        </div></>
    return <section className="os-notes-private" aria-labelledby="os-notes-private-title" aria-busy={busy}>
        <header><h2 id="os-notes-private-title" ref={heading} tabIndex={-1}>Private notes</h2><p className="os-sub">On {chainId}, for {owner.slice(0, 10)}…{owner.slice(-4)}</p></header>
        <div className="os-notes-private-state">
            {firstKey !== null && state.generation === firstKey && <p className="os-notes-private-first"><b>Your first key setup took effect.</b> The recovery phrase and file from that first setup are the ones that open this key; a later setup was refused.</p>}
            {firstOpen && firstKey === null && <p className="os-notes-private-first">Your first key setup may still reach the network. If it does, a new setup is refused and the first key stays yours: keep the recovery phrase and file from your first setup until a setup is confirmed.</p>}
            {body}</div>
        <p className="os-notes-private-notice" role="status" aria-live="polite">{notice}</p>
        {sheet === 'setup' && <PrivateKeySetup controller={controller} client={client} store={store} owner={owner} requestSession={requestSession} wallet={adenaWallet}
            walletProblem={walletProblem} onClose={() => { setSheet(null); checkAgain(n => n + 1); heading.current?.focus() }} />}
        {sheet === 'recover' && <RecoverySheet controller={controller} fileNeeded={state.mode === 'standard'} onClose={done => { setSheet(null); if (done) setNotice('Unlocked in this window.'); heading.current?.focus() }} />}
    </section>
}

/** A second device, or a wallet that no longer gives the same signature: the 24 words and the recovery file. */
function RecoverySheet({ controller, fileNeeded, onClose }: { controller: NotesIdentityController; fileNeeded: boolean; onClose(done: boolean): void }) {
    const [phrase, setPhrase] = useState(''), [file, setFile] = useState<string | null>(null), [error, setError] = useState(''), [working, setWorking] = useState(false)
    const live = useRef(true)
    useEffect(() => { live.current = true; return () => { live.current = false } }, [])
    async function recover() {
        setError(''); setWorking(true)
        try { await controller.recover(phrase, file ?? undefined); if (live.current) onClose(true) }
        catch (problem) {
            if (!live.current) return
            setWorking(false)
            setError(problem instanceof NotesCryptoError && problem.code === 'format' ? 'Check the 24 words and the file: they are not a valid recovery phrase and recovery file.'
                : 'This phrase and file do not open the key registered for this account on this network. Nothing was changed.')
        }
    }
    return <NoteSheet label="Use your recovery phrase" onClose={working ? undefined : () => onClose(false)}>
        <h2>Use your recovery phrase</h2>
        <p>Enter the 24 words Memba gave you when you set up private notes. Never enter your wallet&rsquo;s recovery phrase here.</p>
        <label className="os-notes-private-field">Recovery phrase
            <textarea value={phrase} rows={4} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus onChange={event => setPhrase(event.target.value)} /></label>
        <label className="os-notes-private-field">Recovery file{fileNeeded ? '' : ' (optional)'}
            <input type="file" accept="application/json,.json" onChange={event => {
                const chosen = event.target.files?.[0]; setFile(null); setError('')
                if (!chosen) return
                if (chosen.size > 24_000) { setError('This file is too large to be a Memba recovery file.'); return }
                void chosen.text().then(text => { if (live.current) setFile(text) }, () => { if (live.current) setError('The file could not be read.') })
            }} /></label>
        {error && <p className="os-notes-field-error" role="alert">{error}</p>}
        <div className="os-notes-sheet-actions">
            <button type="button" className="os-btn os-quiet" disabled={working} onClick={() => onClose(false)}>Cancel</button>
            <button type="button" className="os-btn" disabled={working || !phrase.trim() || (fileNeeded && file === null)} onClick={() => void recover()}>{working ? 'Unlocking…' : 'Unlock'}</button>
        </div>
    </NoteSheet>
}
