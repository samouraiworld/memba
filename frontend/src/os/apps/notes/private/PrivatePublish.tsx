import { useEffect, useState, useSyncExternalStore } from 'react'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { gnotAmount } from '../../../../lib/notes/chain/quote'
import { NotesChainError, type ChainNote } from '../../../../lib/notes/chain/schema'
import { equalBytes } from '../../../../lib/notes/crypto/bytes'
import type { NotesStore } from '../../../../lib/notes/drafts'
import { NotesIntents } from '../../../../lib/notes/intents'
import { newNoteId, notesDeployment, privateNotesDeployment } from '../../../../lib/notes/config'
import { NotesTimeoutError, withTimeout } from '../../../../lib/notes/freshness'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { PrivateNoteNoAccess, prepareEncryptedEpoch, preparePrivateNoteRequest, privateNoteBudget, privateNoteMessage, privateNoteQuote } from '../../../../lib/notes/private'
import type { PrivateNoteOperation } from '../../../../lib/notes/private'
import { freshFeeForGasWanted } from '../../../../lib/grc20'
import type { PrivateReviewProps } from '../PublicPublish'
import { balanceOf } from '../notesFormat'
import { adenaWallet, unlockProblem } from './unlock'
import { withKey } from './keyQueue'
import './notes-private.css'

type Bound = { controller: NotesIdentityController; client: NotesReadClient; store: NotesStore; owner: string }
const open = (client: NotesReadClient) => privateNotesDeployment(client.chainId)?.realm === client.realm

/** "Private · encrypted, only you" in the Visibility list: it opens only for a key Memba can unlock here. */
export function PrivateChoice({ controller, client, checked, disabled, onChoose, onSetUp }: Bound & { checked: boolean; disabled: boolean; onChoose(): void; onSetUp(): void }) {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const [unreadable, setUnreadable] = useState(false)
    useEffect(() => { if (controller.getSnapshot().phase === 'unknown') void withKey(controller, () => controller.refresh()).catch(() => setUnreadable(true)) }, [controller])
    const usable = open(client) && (state.phase === 'locked' || state.phase === 'unlocked') && !!state.mode
    const setUp = open(client) && (state.phase === 'empty' || state.phase === 'prepared')
    const hint = !open(client) ? 'Not available on this network' : usable ? 'Encrypted in this browser before it is sent'
        : setUp ? 'Set up private notes first' : state.phase === 'unknown' ? (unreadable ? 'Your private key could not be checked' : 'Checking your private key…')
        : 'Your private key cannot be used in Memba'
    return <div className="os-notes-private-choice">
        <label><input type="radio" name="visibility" checked={checked} disabled={disabled || !usable} onChange={onChoose} /> Private · encrypted, only you <small>{hint}</small></label>
        {setUp && <button type="button" className="os-notes-link" onClick={onSetUp}>Open Private notes</button>}
    </div>
}

type Sealed = { operation: PrivateNoteOperation; generation: string; cap: string; estimate: string; fee: string; networkFee: number | null; balance: bigint | null }
function problemText(error: unknown): string {
    if (error instanceof PrivateNoteNoAccess) return 'Your unlocked key is not the one registered for this account on the network. Nothing was encrypted or sent.'
    if (error instanceof NotesChainError && error.code === 'stale') return 'Your draft or the note changed meanwhile. Nothing was sent. Go back, then publish again.'
    if (error instanceof NotesChainError && error.code === 'disabled') return 'Private notes are not available on this network right now. Nothing was sent.'
    if (error instanceof NotesTimeoutError) return 'The network did not answer in time. Nothing was sent. Try again in a moment.'
    return 'The private publication could not be prepared. Nothing was sent. Your text is kept.'
}
/** The review of a private publication: unlock, encrypt here, say what stays public and what it costs, then the OS signature sheet. */
export function PrivateReview(props: Bound & PrivateReviewProps) {
    if (!open(props.client)) return <>
        <p>Private notes are not available on this network right now. Nothing was sent.</p>
        <div className="os-notes-sheet-actions"><button type="button" className="os-btn os-quiet" onClick={props.onBack}>Back</button></div></>
    return <Review {...props} />
}
function Review({ controller, client, store, owner, draft, title, requestSession, walletChainId, onBack, submit }: Bound & PrivateReviewProps) {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const [sealed, setSealed] = useState<Sealed | null>(null), [problem, setProblem] = useState(''), [working, setWorking] = useState(false)
    const { phase, generation } = state, body = draft.payload.kind === 'public' ? draft.payload.body : null
    // Encrypted only while unlocked, for the key generation the network has for this account: a lock drops it.
    useEffect(() => {
        if (phase !== 'unlocked' || body === null || generation === undefined) return
        const lifetime = new AbortController()
        void (async () => {
            const [key, config] = await withTimeout(Promise.all([client.key(owner), client.config()]))
            if (!key.active || key.generation !== generation) throw new PrivateNoteNoAccess('other-key')
            // Sealed for the registered key, and only once the unlocked key proves to be that same key.
            const prepared = await withKey(controller, () => controller.use(identity => {
                if (!equalBytes(identity.publicKey, key.publicKey)) throw new PrivateNoteNoAccess('other-key')
                return prepareEncryptedEpoch({ chainId: client.chainId, realm: client.realm, noteId: draft.scope.noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: 0, owner, recipients: [{ key, writer: true }], title, body })
            }))
            const operation: PrivateNoteOperation = { chainId: client.chainId, caller: owner, noteId: draft.scope.noteId, operationId: newNoteId(), action: { kind: 'create', prepared, maxFeeUgnot: config.createFeeUgnot } }
            const budget = privateNoteBudget(privateNoteMessage(operation, client.realm, '0', { note: null, epoch: null, config }))
            const [networkFee, balance, durable] = await Promise.all([freshFeeForGasWanted(budget.gasWanted).catch(() => null), balanceOf(client.chainId, owner), withTimeout(store.getDraft(draft.scope))])
            if (!durable || durable.localRevision !== draft.localRevision) throw new NotesChainError('stale')
            if (!lifetime.signal.aborted) setSealed({ operation, generation, cap: budget.suggestedCapUgnot, estimate: budget.estimatedDepositUgnot, fee: config.createFeeUgnot, networkFee, balance })
        })().catch(error => { if (!lifetime.signal.aborted) setProblem(problemText(error)) })
        return () => { lifetime.abort(); setSealed(null) }
    }, [phase, generation, body, title, draft, controller, client, owner, store])
    const [unlocking, setUnlocking] = useState(false)
    async function unlock() {
        setProblem(''); setUnlocking(true)
        try { await withKey(controller, () => controller.unlockStandard(adenaWallet())) } catch (error) { setProblem(unlockProblem(error)) } finally { setUnlocking(false) }
    }
    async function publish(current: Sealed) {
        if (working) return
        setWorking(true); setProblem('')
        // A lock or another key generation while the request waits refuses it before the wallet (privateSignal).
        const lease = new AbortController()
        const stop = controller.subscribe(() => { const now = controller.getSnapshot(); if (now.phase !== 'unlocked' || now.generation !== current.generation) lease.abort() })
        let confirmed: ChainNote | null = null
        try {
            const pending = preparePrivateNoteRequest({ client, operation: current.operation, maxDepositUgnot: current.cap, draftLocalRevision: draft.localRevision,
                session: requestSession, intents: new NotesIntents(store), quote: privateNoteQuote(client, current.cap), isWriteEnabled: () => !!notesDeployment(client.chainId),
                isPrivateSessionCurrent: () => !lease.signal.aborted, privateSignal: lease.signal, onConfirmed: note => { confirmed = note } })
            // A late request after a timeout is dismissed; it has recorded nothing and opened no wallet.
            const request = await withTimeout(pending).catch(error => { void pending.then(late => late.onDismissed?.(), () => {}); throw error })
            const { onSettled, onDismissed } = request
            request.onSettled = (outcome, choice) => { stop(); onSettled?.(outcome, choice) }
            request.onDismissed = () => { stop(); onDismissed?.() }
            request.sub = `“${title}”, encrypted: only you can read it.`
            if (!submit(request, () => confirmed)) stop()
        } catch (error) { stop(); setProblem(problemText(error)); setWorking(false) }
    }
    const walletProblem = walletChainId && walletChainId !== client.chainId ? `Adena is on ${walletChainId}, this note lives on ${client.chainId}. Switch Adena to ${client.chainId} first.` : ''
    const total = sealed && BigInt(sealed.estimate) + BigInt(sealed.fee) + BigInt(sealed.networkFee ?? 0)
    const short = sealed && total !== null && sealed.balance !== null && sealed.balance < total
    let content
    if (body === null) content = <p>This draft cannot be published privately.</p>
    else if (phase === 'locked' && state.mode === 'standard') content = <>
        <p><b>Unlock your private key to encrypt this note.</b> Adena signs a fixed message. It is not a transaction and costs nothing. Sign it only on memba.club.</p>
        {walletProblem && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
        <div className="os-notes-private-actions"><button type="button" className="os-btn" disabled={unlocking || state.busy || !!walletProblem} onClick={() => void unlock()}>{unlocking ? 'Waiting for Adena…' : 'Unlock'}</button></div></>
    else if (phase !== 'unlocked') content = <p>Unlock your private key in Private notes (with your recovery phrase), then publish again. Nothing was sent.</p>
    else if (!sealed && !problem) content = <div className="os-notes-sheet-wait" role="status"><span className="os-spin" aria-hidden="true" />Encrypting in this browser…</div>
    else if (sealed) {
        const p = sealed.operation.action.prepared
        content = <><dl className="os-notes-facts">
            <div><dt>What is stored</dt><dd>The title and text, encrypted in this browser. Only your private key can open them.</dd></div>
            <div><dt>Public on the network</dt><dd>Your address as the owner, the encrypted sizes (title {p.title.length} bytes, text {p.body.length} bytes) and when it was published. Not the title or the text.</dd></div>
            <div><dt>Cost</dt><dd><strong className="os-notes-cost">≈ {gnotAmount(sealed.estimate)}</strong> locked as storage deposit, plus a {gnotAmount(sealed.fee)} publication fee that is not returned. Deleting the note later returns about half of the deposit; the rest stays locked.
                <small>At most {gnotAmount(sealed.cap)}, written in the transaction. Network fee at most {sealed.networkFee === null ? 'what Adena shows' : gnotAmount(sealed.networkFee)}; Adena usually charges less.</small></dd></div>
            <div><dt>On this device</dt><dd>Your unencrypted draft stays on this device after publishing. You can remove it from the note afterwards.</dd></div>
        </dl>
            {walletProblem && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
            {short && <p className="os-notes-field-error" role="alert"><b>This costs ≈ {gnotAmount(String(total))}; your balance is {gnotAmount(String(sealed.balance))}.</b> Nothing was sent. Your text is kept.</p>}</>
    }
    return <div className="os-notes-private-sheet">
        <h2>Publish “{title}” privately?</h2>
        {content}
        {problem && <p className="os-notes-field-error" role="alert">{problem}</p>}
        <div className="os-notes-sheet-actions">
            <button type="button" className="os-btn os-quiet" disabled={working} onClick={onBack}>Back</button>
            <button type="button" className="os-btn" disabled={!sealed || working || !!walletProblem || !!short} onClick={() => sealed && void publish(sealed)}>{working ? 'Preparing…' : 'Publish privately with Adena'}</button>
        </div>
    </div>
}
