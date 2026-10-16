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
import { confirmUnreadable, encodePrivateText, fieldHashes, openPrivateDraft, parseEpochPage, parseReaders, parseWriters, preparePrivateNoteRequest, PrivateNoteDisagreement, PrivateNoteNoAccess, PrivateNoteUnreadable, PrivateStorageAboveCap, privateNoteBudget, privateNoteMessage,
    privateNoteQuote, readPrivateAccess, sealAccessManifest, sealRotation, UNREADABLE_REPLACEMENT, type PrivateAccessBase, type PrivateCommitSizes, type PrivateNoteAction } from '../../../../lib/notes/private'
import { readDraftSlot } from '../../../../lib/notes/draftSlot'
import { useSigner } from '../../../sign/signerContext'
import { balanceOf, shortAddress } from '../notesFormat'
import { withKey } from './keyQueue'

export interface PrivateReadersProps {
    note: ChainNote; client: NotesReadClient; controller: NotesIdentityController; owner: string; store: NotesStore; walletChainId?: string
    /** Lifetime of a signed change's confirmation; the workspace's, so a remount never cancels it. */
    requestSession?: DraftSession
}
type Kind = 'add' | 'remove' | 'promote' | 'demote'
type Review = { kind: Kind; who: string | null; name?: string; off: string[]; action: PrivateNoteAction; note: ChainNote; base: PrivateCommitSizes | PrivateAccessBase
    generation: string; cap: string; estimate: string; fee: number | null; balance: bigint | null; remaining: number }
class Refusal extends Error {}
/** Adding is refused while some holder's key is turned off (the realm validates every envelope): offer to remove them. */
class KeysOff extends Refusal {}
/** A Rotate cannot re-encrypt a current text that does not decrypt: offer to replace it in the same Rotate (review P2). */
type Retry = { kind: Kind; who: string | null; name?: string }
type Hashes = Partial<Record<'title' | 'body', string>>
class Unreadable extends Refusal { constructor(message: string, readonly retry: Retry & { hashes: Hashes }) { super(message) } }
/** Two reads of the latest text disagree (a node served other bytes): no replacement is offered, only another try. */
class Disagree extends Refusal { constructor(readonly retry: Retry) { super('The network’s answers about this note’s latest text disagree, so Memba does not offer to replace it. Nothing was sent. Try again in a moment.') } }
const MAX_READERS = 32

/**
 * "Who can read" a private note, and who can edit it, in its Share menu. The owner adds a reader (ApplyAccess: the
 * current epoch's key is wrapped for their registry key) or removes one (Rotate: a new key, the current text encrypted
 * again for the others), and makes a reader a writer (ApplyAccess, the writer flag of their envelope) or a writer a
 * reader again (Rotate: the realm refuses a writer downgrade without a new epoch). Everyone else sees the list. Reader
 * and writer addresses are public on the network, and the wording says so before signing.
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
    const [readers, setReaders] = useState<{ all: string[]; writers: string[] } | null>(null), [failed, setFailed] = useState(false), [reload, retry] = useState(0)
    const [input, setInput] = useState(''), [busy, setBusy] = useState(false), [signing, setSigning] = useState(false)
    const [prepared, setReview] = useState<Review | null>(null), [problem, setProblem] = useState(''), [keysOff, setKeysOff] = useState(false), [recovery, setRecovery] = useState<Unreadable['retry'] | null>(null), [again, setAgain] = useState<Retry | null>(null)
    // This list's own session: it ends with the list (another revision, account, network, a closed window).
    const [life] = useState(createDraftSession)
    useLayoutEffect(() => () => life.invalidate(), [life])
    const manage = note.owner === owner, unlocked = phase === 'unlocked'
    // A lock or another key ends a review prepared with this key: it is no longer shown, and never signed.
    const review = prepared && unlocked && prepared.generation === generation ? prepared : null
    // The public reader and writer lists (no key): the realm's ReadersJSON (the owner included) and WritersJSON.
    useEffect(() => {
        let alive = true
        void withTimeout(Promise.all([client.readersRaw(note.id), client.writersRaw(note.id)])).then(([all, writers]) => {
            if (alive) { setReaders({ all: parseReaders(all), writers: parseWriters(writers) }); setFailed(false) }
        }).catch(() => { if (alive) setFailed(true) })
        return () => { alive = false }
    }, [client, note.id, reload])
    /** `who` null: remove only the holders whose private-notes key is turned off. */
    /**
     * The owner's text that replaces an unreadable field: their own encrypted draft of this note on this device, when it
     * opens with the unlocked key and holds valid text; otherwise the fixed notice. Never anything else.
     */
    async function replacementText(signal: AbortSignal): Promise<{ text: { title: string; body: string }; source: 'draft' | 'notice' }> {
        const scope = { chainId: client.chainId, realm: client.realm, owner, noteId: note.id }, generation = controller.getSnapshot().generation
        try {
            const slot = await withTimeout(readDraftSlot(store, scope, { signal }))
            const record = slot.draft?.payload.kind === 'encrypted' ? { revision: slot.draft.localRevision, envelope: slot.draft.payload.envelope } : null
            if (record && generation) {
                const draft = await withKey(controller, () => controller.use(identity => openPrivateDraft(scope, BigInt(record.revision), BigInt(generation), identity, record.envelope)))
                encodePrivateText(draft.title, true).fill(0); encodePrivateText(draft.body).fill(0)
                return { text: { title: draft.title, body: draft.body }, source: 'draft' }
            }
        } catch { if (signal.aborted) throw new NotesChainError('session') }
        return { text: UNREADABLE_REPLACEMENT, source: 'notice' }
    }
    /** `recover`: the agreed hashes of the unreadable fields; the owner chose to replace them (and only them). */
    async function prepare(signal: AbortSignal, kind: Kind, who: string | null, name?: string, added?: ChainKey, recover?: Hashes) {
        const generation = controller.getSnapshot().generation
        if (!generation || controller.getSnapshot().phase !== 'unlocked') throw new NotesChainError('session')
        const pending = await withTimeout(new NotesIntents(store).list({ chainId: client.chainId, realm: client.realm, owner }))
        if (pending.some(item => item.scope.noteId === note.id && ['prepared', 'submitted', 'unknown'].includes(item.phase)))
            throw new Refusal('An earlier change to this note has an unresolved receipt. Check it before another change; nothing was resent.')
        const fresh = await withTimeout(client.note(note.id))
        if (!fresh || fresh.deleted || fresh.mode > 1 || fresh.owner !== owner || fresh.stateRevision !== note.stateRevision) throw new NotesChainError('stale')
        const [epoch, previousManifest] = await withTimeout(Promise.all([client.epochMetadataRaw(fresh.id, fresh.epoch), readPrivateAccess(client, fresh, signal)]))
        const current = decodeManifest(previousManifest, Number(fresh.epoch)).map(entry => ({ who: bech32Encode('g', entry.address), writer: entry.writer }))
        // A role change is for a current holder in the other role, as read now from the chain (not from the list shown).
        const role = current.find(entry => entry.who === who)
        if ((kind === 'promote' || kind === 'demote') && (!role || who === owner || role.writer !== (kind === 'demote'))) throw new NotesChainError('stale')
        // Every envelope is made again for its holder's registry key now, and the realm accepts only active keys. A removal
        // or an end of editing (both a Rotate) therefore also drops every holder whose key is turned off (named in the
        // review); an addition or a new writer cannot (ApplyAccess never removes anyone), so it is refused with the way out.
        const others = current.filter(entry => kind !== 'remove' || entry.who !== who)
        const keys = await withTimeout(Promise.all(others.map(entry => client.key(entry.who))))
        const off = others.filter((entry, i) => !keys[i].active && entry.who !== owner).map(entry => entry.who)
        if (who !== null && off.includes(who)) throw new Refusal('Their private-notes key is turned off, so their access cannot change: remove them instead. Nothing was sent.')
        if ((kind === 'add' || kind === 'promote') && off.length) throw new KeysOff(`${off.map(shortAddress).join(', ')} turned off their private-notes key, so nobody can be ${kind === 'add' ? 'added' : 'made a writer'} until they are removed. Nothing was sent.`)
        if (who === null && !off.length) throw new NotesChainError('stale')
        const kept = others.map((entry, i) => ({ ...entry, key: keys[i] })).filter(entry => !off.includes(entry.who))
        const recipients = [...kept.map(entry => ({ key: entry.key, writer: entry.who === who && kind !== 'remove' ? kind === 'promote' : entry.writer })), ...added ? [{ key: added, writer: false }] : []]
        const access = { kind: 'identity' as const, owner, identity: controller }
        let action: PrivateNoteAction, base: PrivateCommitSizes | PrivateAccessBase
        if (kind === 'add' || kind === 'promote') {
            const manifest = await withKey(controller, () => sealAccessManifest(client, fresh, 1, recipients, { access, signal }))
            action = { kind: 'access', mode: 1, manifest, previousManifest, acknowledgeEpochHistory: true }
            base = { envelopes: current.length, writers: current.filter(entry => entry.writer).length }
        } else {
            // Only the owner left: the note becomes Private (only me) again.
            const rotate = (replacement?: { title: string; body: string }) => withKey(controller, () => sealRotation(client, fresh, recipients.length === 1 ? 0 : 1, recipients, { access, signal }, replacement))
            let prepared, replaced: { actor: string; fields: readonly ('title' | 'body')[]; source: 'draft' | 'notice' } | undefined
            try { prepared = await rotate() } catch (error) {
                if (!(error instanceof PrivateNoteUnreadable)) throw error
                // The epoch key opened and matched, but the latest text does not decrypt: never a dead end, never silent.
                // Never on one answer: the same ciphertext must come back again (another node when there is one), and the
                // replacement prepared later must be for exactly those bytes.
                if (!recover) {
                    const hashes = await confirmUnreadable(client, fresh, error.fields, signal).catch(failure => { throw failure instanceof PrivateNoteDisagreement ? new Disagree({ kind, who, name }) : failure })
                    throw new Unreadable(`The latest ${error.fields.join(' and ')} of this note, published by ${error.actor === owner ? 'you' : shortAddress(error.actor)}, cannot be decrypted by anyone, so it cannot be encrypted again for a new key. You can replace it in the same change: with your draft of this note on this device if there is one, otherwise with a short notice. Nothing was sent.`, { kind, who, name, hashes })
                }
                if (JSON.stringify(fieldHashes(fresh, error.fields)) !== JSON.stringify(recover)) throw new Disagree({ kind, who, name })
                const replacement = await replacementText(signal)
                prepared = await rotate(replacement.text); replaced = { actor: error.actor, fields: error.fields, source: replacement.source }
            }
            action = { kind: 'rotate', prepared, previousManifest, ...replaced ? { replaced } : {} }
            base = { title: fresh.title.length, body: fresh.body!.length }
        }
        const operation = { chainId: client.chainId, caller: owner, noteId: fresh.id, operationId: newNoteId(), action }
        const budget = privateNoteBudget(privateNoteMessage(operation, client.realm, '0', { note: fresh, epoch: parseEpochPage(epoch, fresh.epoch) }), base)
        const [fee, balance] = await Promise.all([freshFeeForGasWanted(budget.gasWanted).catch(() => null), balanceOf(client.chainId, owner)])
        if (!signal.aborted) setReview({ kind, who, name, off, action, note: fresh, base, generation, cap: budget.suggestedCapUgnot, estimate: budget.estimatedDepositUgnot, fee, balance, remaining: recipients.length - 1 })
    }
    async function run(step: (signal: AbortSignal) => Promise<void>) {
        if (busy) return
        const { signal } = life.capture()
        setBusy(true); setProblem(''); setKeysOff(false); setRecovery(null); setAgain(null); setDone('')
        try { await step(signal) } catch (error) {
            if (!signal.aborted) { setProblem(problemText(error)); setKeysOff(error instanceof KeysOff); setRecovery(error instanceof Unreadable ? error.retry : null); setAgain(error instanceof Disagree ? error.retry : null) }
        } finally { if (!signal.aborted) setBusy(false) }
    }
    const add = () => run(async signal => {
        const target = await resolveRecipient(input)
        if (target.kind === 'invalid') throw new Refusal(target.reason)
        if (target.kind === 'unregistered') throw new Refusal(`@${target.name} is not a registered username.`)
        if (target.kind === 'unreachable') throw new Refusal('The username registry could not be read. Try again, or paste their g1 address.')
        const who = target.address
        if (who === owner) throw new Refusal('That is you: you can always read your own note.')
        if (readers?.all.includes(who)) throw new Refusal('They can already read this note.')
        if ((readers?.all.length ?? MAX_READERS) >= MAX_READERS) throw new Refusal(`A private note can have at most ${MAX_READERS} readers, you included.`)
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
            const { onSettled, onDismissed } = request, next = String(BigInt(current.note.stateRevision) + 1n), who = [current.who && (current.name ? `@${current.name}` : shortAddress(current.who)), ...current.off.map(shortAddress)].filter(Boolean).join(', ')
            request.onDismissed = () => { stop(); onDismissed?.(); if (!signal.aborted) setSigning(false) }
            request.onSettled = (outcome, choice) => {
                stop(); onSettled?.(outcome, choice)
                if (outcome === 'confirmed') {
                    setDone({ add: `${who} can now read this note.`, remove: `${who} was removed. They keep what they already read; new versions are hidden from them.`,
                        promote: `${who} can now edit this note.`, demote: `${who} can no longer edit this note. They can still read it.` }[current.kind])
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
    const others = readers?.all.filter(who => who !== note.owner) ?? []
    const walletProblem = walletChainId && walletChainId !== client.chainId ? `Adena is on ${walletChainId}, this note lives on ${client.chainId}. Switch Adena to ${client.chainId} first.` : ''
    const total = review && BigInt(review.cap) + BigInt(review.fee ?? 0), short = !!review && total !== null && review.balance !== null && review.balance < total
    const target = review?.who ? review.name ? `@${review.name} (${shortAddress(review.who)})` : shortAddress(review.who) : null
    return <section className="os-notes-share-part" aria-label="Who can read">
        <h3 className="os-notes-share-k">Who can read</h3>
        {failed ? <><p role="alert">Who can read this note could not be checked.</p><button type="button" className="os-btn os-quiet" onClick={() => retry(n => n + 1)}>Retry</button></>
            : !readers ? <p role="status">Checking who can read…</p>
            : <ul className="os-notes-readers">
                <li><span>{note.owner === owner ? 'You' : shortAddress(note.owner)} <small>owner · can edit</small></span></li>
                {others.map(who => { const writer = readers.writers.includes(who)
                    return <li key={who}><span title={who}>{who === owner ? 'You' : shortAddress(who)}{!manage && writer && <small> can edit</small>}</span>
                        {manage && <label className="os-notes-reader-edit"><input type="checkbox" checked={writer} disabled={!unlocked || busy || signing || !!review}
                            onChange={() => void run(signal => prepare(signal, writer ? 'demote' : 'promote', who))} /> Can edit</label>}
                        {manage && <button type="button" className="os-btn os-quiet" disabled={!unlocked || busy || signing || !!review} onClick={() => void run(signal => prepare(signal, 'remove', who))}>Remove…</button>}</li> })}
            </ul>}
        {manage && !unlocked && <p className="os-notes-share-note">Unlock this note to add or remove readers, or to change who can edit.</p>}
        {manage && unlocked && !review && <form className="os-notes-share-add" onSubmit={event => { event.preventDefault(); void add() }}>
            <label>Add a reader<input value={input} disabled={busy || signing} onChange={event => setInput(event.target.value)} placeholder="@username or g1 address" autoComplete="off" spellCheck={false} /></label>
            <button type="submit" className="os-btn" disabled={busy || signing || !input.trim() || !readers}>{busy ? 'Encrypting…' : 'Add…'}</button>
        </form>}
        {manage && <p className="os-notes-share-note">A reader’s address becomes public on the network, as a reader of this note. They need their own private notes key.
            A reader who can edit changes the title and the text; only you share the note, remove readers, change who can edit or delete it.</p>}
        {review && <div className="os-notes-share-review" role="group" aria-label={{ add: 'Share review', remove: 'Removal review', promote: 'Editing review', demote: 'End of editing review' }[review.kind]}>
            <p><b>{{ add: `Share with ${target}?`, remove: target ? `Remove ${target}?` : 'Remove the readers whose key is turned off?', promote: `Let ${target} edit?`, demote: `Stop ${target} editing?` }[review.kind]}</b></p>
            <dl className="os-notes-facts">
                {review.action.kind === 'rotate' && review.action.replaced && <div><dt>Latest text</dt><dd>Published by {review.action.replaced.actor === owner ? 'you' : shortAddress(review.action.replaced.actor)}, it cannot be decrypted by anyone. In the new key its {review.action.replaced.fields.join(' and ')} {review.action.replaced.fields.length > 1 ? 'are' : 'is'} replaced by {review.action.replaced.source === 'draft' ? 'your draft of this note on this device' : `a short notice: “${UNREADABLE_REPLACEMENT.body}”`}.</dd></div>}
                {review.kind === 'promote' ? <>
                    <div><dt>What they can do</dt><dd>Change the title and the text, and publish those changes: they sign them and pay the storage deposit for any growth. You stay the owner: only you share the note, remove readers, change who can edit or delete it.
                        A writer can also change the text so that it no longer opens for anyone; you can then replace it or delete the note.</dd></div>
                    <div><dt>Public on the network</dt><dd>Their address, as a writer of this note. Not the title or the text.</dd></div>
                </> : review.kind === 'demote' ? <>
                    {review.off.length > 0 && <div><dt>Also removed</dt><dd>{review.off.map(shortAddress).join(', ')}, because their private-notes key is turned off: a new key cannot be made for them.</dd></div>}
                    <div><dt>What changes</dt><dd>They can still read the note, but can no longer publish changes. The network allows this only with a new key: the current text is encrypted again for you and {review.remaining === 1 ? 'them' : `the ${review.remaining} other readers`}. Changes they already published stay.</dd></div>
                </> : review.kind === 'add' ? <>
                    <div><dt>What they can read</dt><dd>This note as it is now, and its earlier versions since its key last changed (they stay in chain history). Not versions from before that.</dd></div>
                    <div><dt>Public on the network</dt><dd>Their address, as a reader of this note. Not the title or the text.</dd></div>
                </> : <>
                    {review.off.length > 0 && <div><dt>Also removed</dt><dd>{review.off.map(shortAddress).join(', ')}, because their private-notes key is turned off: a new key cannot be made for them.</dd></div>}
                    <div><dt>What changes</dt><dd>They keep what they already read; new versions are hidden from them. The note gets a new key, and its current text is encrypted again for {review.remaining ? `you and ${review.remaining === 1 ? 'the other reader' : `the ${review.remaining} other readers`}` : 'you only'}. Added back later, a reader can read only the versions from then on.</dd></div>
                </>}
                <div><dt>Cost</dt><dd><strong className="os-notes-cost">≈ {approxGnot(review.estimate)}</strong> locked as storage deposit; no publication fee.
                    <small>At most {gnotAmount(review.cap)}, written in the transaction. Network fee at most {review.fee === null ? 'what Adena shows' : gnotAmount(review.fee)}; Adena usually charges less.</small></dd></div>
            </dl>
            {walletProblem && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
            {short && <p className="os-notes-field-error" role="alert"><b>This can cost up to {gnotAmount(String(total))}; your balance is {gnotAmount(String(review.balance))}.</b> Nothing was sent.</p>}
            <div className="os-notes-share-actions">
                <button type="button" className="os-btn os-quiet" disabled={busy || signing} onClick={() => setReview(null)}>Cancel</button>
                <button type="button" className={review.kind === 'add' || review.kind === 'promote' ? 'os-btn' : 'os-btn os-notes-danger'} disabled={busy || signing || !!walletProblem || short} onClick={() => void send(review)}>
                    {busy ? 'Preparing…' : { add: 'Share with Adena', remove: 'Remove with Adena', promote: 'Allow editing with Adena', demote: 'Stop editing with Adena' }[review.kind]}</button>
            </div>
        </div>}
        {signing && <p className="os-notes-share-progress" role="status"><span className="os-spin" aria-hidden="true" /> Waiting for your signature in the review sheet and Adena…</p>}
        {done && <p className="os-notes-share-done" role="status">{done}</p>}
        {problem && <p className="os-notes-field-error" role="alert">{problem}</p>}
        {recovery && manage && unlocked && !review && <button type="button" className="os-btn" disabled={busy || signing} onClick={() => void run(signal => prepare(signal, recovery.kind, recovery.who, recovery.name, undefined, recovery.hashes))}>Replace the text and continue…</button>}
        {again && manage && unlocked && !review && <button type="button" className="os-btn os-quiet" disabled={busy || signing} onClick={() => void run(signal => prepare(signal, again.kind, again.who, again.name))}>Try again</button>}
        {keysOff && manage && unlocked && !review && <button type="button" className="os-btn os-quiet" disabled={busy || signing} onClick={() => void run(signal => prepare(signal, 'remove', null))}>Remove them…</button>}
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
