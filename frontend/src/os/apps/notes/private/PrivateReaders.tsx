import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { bech32Encode } from '../../../../lib/dao/realmAddress'
import { freshFeeForGasWanted } from '../../../../lib/grc20'
import { resolveRecipient } from '../../../../lib/nameResolve'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { approxGnot } from '../../../../lib/notes/chain/costText'
import { gnotAmount } from '../../../../lib/notes/chain/quote'
import { NotesChainError, type ChainKey, type ChainNote } from '../../../../lib/notes/chain/schema'
import { newNoteId, notesDeployment, privateNotesDeployment } from '../../../../lib/notes/config'
import { decodeManifest } from '../../../../lib/notes/crypto/manifest'
import { createDraftSession, type DraftSession, type NotesStore } from '../../../../lib/notes/drafts'
import { announceNoteChange, NotesTimeoutError, withTimeout } from '../../../../lib/notes/freshness'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { NotesIntents } from '../../../../lib/notes/intents'
import { parseEpochPage, parseReaders, preparePrivateNoteRequest, PrivateNoteNoAccess, PrivateStorageAboveCap, privateNoteBudget, privateNoteMessage, privateNoteQuote,
    readPrivateAccess, sealAccessManifest, sealRotation, type PrivateAccessBase, type PrivateCommitSizes, type PrivateNoteAction } from '../../../../lib/notes/private'
import { useSigner } from '../../../sign/signerContext'
import { balanceOf, shortAddress } from '../notesFormat'
import { withKey } from './keyQueue'

export interface PrivateReadersProps {
    note: ChainNote; client: NotesReadClient; controller: NotesIdentityController; owner: string; store: NotesStore; walletChainId?: string
    /** Lifetime of a signed change's confirmation; the workspace's, so a remount never cancels it. */
    requestSession?: DraftSession
}
type Review = { kind: 'add' | 'remove'; who: string; name?: string; action: PrivateNoteAction; note: ChainNote; base: PrivateCommitSizes | PrivateAccessBase
    generation: string; cap: string; estimate: string; fee: number | null; balance: bigint | null; remaining: number }
class Refusal extends Error {}
const MAX_READERS = 32

/**
 * "Who can read" a private note, in its Share menu. The owner adds a reader (ApplyAccess: the current epoch's key is
 * wrapped for their registry key) or removes one (Rotate: a new key, the current text encrypted again for the others).
 * Everyone else sees the list. Reader addresses are public on the network, and the wording says so before signing.
 */
export function PrivateReaders(props: PrivateReadersProps) {
    const { note, client, owner } = props
    const [session] = useState(createDraftSession), [done, setDone] = useState('')
    useLayoutEffect(() => () => session.invalidate(), [session])
    if (privateNotesDeployment(client.chainId)?.realm !== client.realm || note.deleted || note.mode > 2) return null
    return <Readers key={[client.chainId, client.realm, owner, note.id, note.stateRevision].join(':')} {...props} session={props.requestSession ?? session} done={done} setDone={setDone} />
}
function Readers({ note, client, controller, owner, store, walletChainId, session, done, setDone }: PrivateReadersProps & { session: DraftSession; done: string; setDone(text: string): void }) {
    const signer = useSigner(), { phase, generation } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const [readers, setReaders] = useState<string[] | null>(null), [failed, setFailed] = useState(false), [reload, retry] = useState(0)
    const [input, setInput] = useState(''), [busy, setBusy] = useState(false), [signing, setSigning] = useState(false)
    const [prepared, setReview] = useState<Review | null>(null), [problem, setProblem] = useState('')
    // This list's own session: it ends with the list (another revision, account, network, a closed window).
    const [life] = useState(createDraftSession)
    useLayoutEffect(() => () => life.invalidate(), [life])
    const manage = note.owner === owner, unlocked = phase === 'unlocked'
    // A lock or another key ends a review prepared with this key: it is no longer shown, and never signed.
    const review = prepared && unlocked && prepared.generation === generation ? prepared : null
    // The public reader list (no key): the realm's ReadersJSON, the owner included.
    useEffect(() => {
        let alive = true
        void withTimeout(client.readersRaw(note.id)).then(raw => { if (alive) { setReaders(parseReaders(raw)); setFailed(false) } }, () => { if (alive) setFailed(true) })
        return () => { alive = false }
    }, [client, note.id, reload])
    async function prepare(signal: AbortSignal, kind: 'add' | 'remove', who: string, name?: string, added?: ChainKey) {
        const generation = controller.getSnapshot().generation
        if (!generation || controller.getSnapshot().phase !== 'unlocked') throw new NotesChainError('session')
        const pending = await withTimeout(new NotesIntents(store).list({ chainId: client.chainId, realm: client.realm, owner }))
        if (pending.some(item => item.scope.noteId === note.id && ['prepared', 'submitted', 'unknown'].includes(item.phase)))
            throw new Refusal('An earlier change to this note has an unresolved receipt. Check it before another change; nothing was resent.')
        const fresh = await withTimeout(client.note(note.id))
        if (!fresh || fresh.deleted || fresh.mode > 1 || fresh.owner !== owner || fresh.stateRevision !== note.stateRevision) throw new NotesChainError('stale')
        const [epoch, previousManifest] = await withTimeout(Promise.all([client.epochMetadataRaw(fresh.id, fresh.epoch), readPrivateAccess(client, fresh, signal)]))
        const current = decodeManifest(previousManifest, Number(fresh.epoch)).map(entry => ({ who: bech32Encode('g', entry.address), writer: entry.writer }))
        const kept = current.filter(entry => kind === 'add' || entry.who !== who)
        // Every envelope is made again for its holder's registry key now: one that is turned off cannot be included.
        const keys = await withTimeout(Promise.all(kept.map(entry => client.key(entry.who))))
        const off = kept.filter((_, i) => !keys[i].active)
        if (off.length) throw new Refusal(`${off.map(entry => shortAddress(entry.who)).join(', ')} turned off their private key. Remove them first.`)
        const recipients = [...kept.map((entry, i) => ({ key: keys[i], writer: entry.writer })), ...added ? [{ key: added, writer: false }] : []]
        const access = { kind: 'identity' as const, owner, identity: controller }
        let action: PrivateNoteAction, base: PrivateCommitSizes | PrivateAccessBase
        if (kind === 'add') {
            const manifest = await withKey(controller, () => sealAccessManifest(client, fresh, 1, recipients, { access, signal }))
            action = { kind: 'access', mode: 1, manifest, previousManifest, acknowledgeEpochHistory: true }
            base = { envelopes: current.length, writers: current.filter(entry => entry.writer).length }
        } else {
            // Only the owner left: the note becomes Private (only me) again.
            const prepared = await withKey(controller, () => sealRotation(client, fresh, recipients.length === 1 ? 0 : 1, recipients, { access, signal }))
            action = { kind: 'rotate', prepared, previousManifest }
            base = { title: fresh.title.length, body: fresh.body!.length }
        }
        const operation = { chainId: client.chainId, caller: owner, noteId: fresh.id, operationId: newNoteId(), action }
        const budget = privateNoteBudget(privateNoteMessage(operation, client.realm, '0', { note: fresh, epoch: parseEpochPage(epoch, fresh.epoch) }), base)
        const [fee, balance] = await Promise.all([freshFeeForGasWanted(budget.gasWanted).catch(() => null), balanceOf(client.chainId, owner)])
        if (!signal.aborted) setReview({ kind, who, name, action, note: fresh, base, generation, cap: budget.suggestedCapUgnot, estimate: budget.estimatedDepositUgnot, fee, balance, remaining: recipients.length - 1 })
    }
    async function run(step: (signal: AbortSignal) => Promise<void>) {
        if (busy) return
        const { signal } = life.capture()
        setBusy(true); setProblem(''); setDone('')
        try { await step(signal) } catch (error) { if (!signal.aborted) setProblem(problemText(error)) } finally { if (!signal.aborted) setBusy(false) }
    }
    const add = () => run(async signal => {
        const target = await resolveRecipient(input)
        if (target.kind === 'invalid') throw new Refusal(target.reason)
        if (target.kind === 'unregistered') throw new Refusal(`@${target.name} is not a registered username.`)
        if (target.kind === 'unreachable') throw new Refusal('The username registry could not be read. Try again, or paste their g1 address.')
        const who = target.address
        if (who === owner) throw new Refusal('That is you: you can always read your own note.')
        if (readers?.includes(who)) throw new Refusal('They can already read this note.')
        if ((readers?.length ?? MAX_READERS) >= MAX_READERS) throw new Refusal(`A private note can have at most ${MAX_READERS} readers, you included.`)
        const key = await withTimeout(client.key(who))
        if (!key.active) throw new Refusal(key.generation === '0' ? 'They need to set up private notes first (in Private notes, with their own wallet). Nothing was sent.'
            : 'They turned off their private key. They need to set up private notes again first. Nothing was sent.')
        await prepare(signal, 'add', who, target.name, key)
    })
    async function send(current: Review) {
        if (busy || signing) return
        const { signal } = life.capture()
        setBusy(true); setProblem('')
        // A lock or another key generation while the request waits refuses it before the wallet (privateSignal).
        const lease = new AbortController()
        const stop = controller.subscribe(() => { const now = controller.getSnapshot(); if (now.phase !== 'unlocked' || now.generation !== current.generation) lease.abort() })
        try {
            const pending = preparePrivateNoteRequest({ client, operation: { chainId: client.chainId, caller: owner, noteId: current.note.id, operationId: newNoteId(), action: current.action },
                reviewed: current.note, maxDepositUgnot: current.cap, draftLocalRevision: '0', session, intents: new NotesIntents(store), quote: privateNoteQuote(client, current.cap, current.base),
                isWriteEnabled: () => !!notesDeployment(client.chainId), isPrivateSessionCurrent: () => !lease.signal.aborted, privateSignal: lease.signal })
            const request = await withTimeout(pending).catch(error => { void pending.then(late => late.onDismissed?.(), () => {}); throw error })
            const { onSettled, onDismissed } = request, next = String(BigInt(current.note.stateRevision) + 1n), who = current.name ? `@${current.name}` : shortAddress(current.who)
            request.onDismissed = () => { stop(); onDismissed?.(); if (!signal.aborted) setSigning(false) }
            request.onSettled = (outcome, choice) => {
                stop(); onSettled?.(outcome, choice)
                if (outcome === 'confirmed') {
                    setDone(current.kind === 'add' ? `${who} can now read this note.` : `${who} was removed. They keep what they already read; new versions are hidden from them.`)
                    announceNoteChange({ chainId: client.chainId, noteId: current.note.id, stateRevision: next })
                }
                if (signal.aborted) return
                setSigning(false); setReview(null)
                if (outcome === 'unknown' || outcome === 'submitted') setProblem(`Not confirmed yet: check whether revision ${next} exists before another change. Nothing was resent.`)
                else if (outcome !== 'confirmed') setProblem('Nothing changed. You can try again.')
            }
            if (signer.sign(request)) setSigning(true)
            else { request.onDismissed?.(); setProblem('The signature window could not open. Close any other signature request, then try again.') }
        } catch (error) { stop(); if (!signal.aborted) setProblem(problemText(error)) }
        finally { if (!signal.aborted) setBusy(false) }
    }
    const others = readers?.filter(who => who !== note.owner) ?? []
    const walletProblem = walletChainId && walletChainId !== client.chainId ? `Adena is on ${walletChainId}, this note lives on ${client.chainId}. Switch Adena to ${client.chainId} first.` : ''
    const total = review && BigInt(review.cap) + BigInt(review.fee ?? 0), short = !!review && total !== null && review.balance !== null && review.balance < total
    const target = review && (review.name ? `@${review.name} (${shortAddress(review.who)})` : shortAddress(review.who))
    return <section className="os-notes-share-part" aria-label="Who can read">
        <h3 className="os-notes-share-k">Who can read</h3>
        {failed ? <><p role="alert">Who can read this note could not be checked.</p><button type="button" className="os-btn os-quiet" onClick={() => retry(n => n + 1)}>Retry</button></>
            : !readers ? <p role="status">Checking who can read…</p>
            : <ul className="os-notes-readers">
                <li><span>{note.owner === owner ? 'You' : shortAddress(note.owner)} <small>owner</small></span></li>
                {others.map(who => <li key={who}><span title={who}>{who === owner ? 'You' : shortAddress(who)}</span>
                    {manage && <button type="button" className="os-btn os-quiet" disabled={!unlocked || busy || signing || !!review} onClick={() => void run(signal => prepare(signal, 'remove', who))}>Remove…</button>}</li>)}
            </ul>}
        {manage && !unlocked && <p className="os-notes-share-note">Unlock this note to add or remove readers.</p>}
        {manage && unlocked && !review && <form className="os-notes-share-add" onSubmit={event => { event.preventDefault(); void add() }}>
            <label>Add a reader<input value={input} disabled={busy || signing} onChange={event => setInput(event.target.value)} placeholder="@username or g1 address" autoComplete="off" spellCheck={false} /></label>
            <button type="submit" className="os-btn" disabled={busy || signing || !input.trim() || !readers}>{busy ? 'Encrypting…' : 'Add…'}</button>
        </form>}
        {manage && <p className="os-notes-share-note">A reader’s address becomes public on the network, as a reader of this note. They need their own private notes key.</p>}
        {review && <div className="os-notes-share-review" role="group" aria-label={review.kind === 'add' ? 'Share review' : 'Removal review'}>
            <p><b>{review.kind === 'add' ? `Share with ${target}?` : `Remove ${target}?`}</b></p>
            <dl className="os-notes-facts">
                {review.kind === 'add' ? <>
                    <div><dt>What they can read</dt><dd>This note as it is now, and its earlier versions since its key last changed (they stay in chain history). Not versions from before that.</dd></div>
                    <div><dt>Public on the network</dt><dd>Their address, as a reader of this note. Not the title or the text.</dd></div>
                </> : <div><dt>What changes</dt><dd>They keep what they already read; new versions are hidden from them. The note gets a new key, and its current text is encrypted again for {review.remaining ? `you and ${review.remaining === 1 ? 'the other reader' : `the ${review.remaining} other readers`}` : 'you only'}.</dd></div>}
                <div><dt>Cost</dt><dd><strong className="os-notes-cost">≈ {approxGnot(review.estimate)}</strong> locked as storage deposit; no publication fee.
                    <small>At most {gnotAmount(review.cap)}, written in the transaction. Network fee at most {review.fee === null ? 'what Adena shows' : gnotAmount(review.fee)}; Adena usually charges less.</small></dd></div>
            </dl>
            {walletProblem && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
            {short && <p className="os-notes-field-error" role="alert"><b>This can cost up to {gnotAmount(String(total))}; your balance is {gnotAmount(String(review.balance))}.</b> Nothing was sent.</p>}
            <div className="os-notes-share-actions">
                <button type="button" className="os-btn os-quiet" disabled={busy || signing} onClick={() => setReview(null)}>Cancel</button>
                <button type="button" className={review.kind === 'add' ? 'os-btn' : 'os-btn os-notes-danger'} disabled={busy || signing || !!walletProblem || short} onClick={() => void send(review)}>
                    {busy ? 'Preparing…' : review.kind === 'add' ? 'Share with Adena' : 'Remove with Adena'}</button>
            </div>
        </div>}
        {signing && <p className="os-notes-share-progress" role="status"><span className="os-spin" aria-hidden="true" /> Waiting for your signature in the review sheet and Adena…</p>}
        {done && <p className="os-notes-share-done" role="status">{done}</p>}
        {problem && <p className="os-notes-field-error" role="alert">{problem}</p>}
    </section>
}
function problemText(error: unknown): string {
    if (error instanceof Refusal) return error.message
    if (error instanceof PrivateStorageAboveCap) return 'This change needs more storage than Memba can approve. Nothing was sent.'
    if (error instanceof PrivateNoteNoAccess) return 'Your unlocked key cannot open this note. Nothing was encrypted or sent.'
    if (error instanceof NotesChainError && error.code === 'stale') return 'The note or someone’s private key changed on the network meanwhile. Nothing was sent; try again.'
    if (error instanceof NotesChainError && error.code === 'session') return 'Your private key was locked meanwhile. Nothing was sent; unlock and try again.'
    if (error instanceof NotesChainError && error.code === 'disabled') return 'Private notes are not available on this network right now. Nothing was sent.'
    if (error instanceof NotesTimeoutError) return 'The network did not answer in time. Nothing was sent. Try again in a moment.'
    return 'This change could not be prepared. Nothing was sent.'
}
