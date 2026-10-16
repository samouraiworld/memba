import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { freshFeeForGasWanted } from '../../../../lib/grc20'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { commentIntentRealm } from '../../../../lib/notes/chain/commentRequest'
import type { PublicComment } from '../../../../lib/notes/chain/comments'
import { approxGnot } from '../../../../lib/notes/chain/costText'
import { encryptedCommentBudget, privateCommentBudget, privateCommentMessage, type PrivateCommentAction } from '../../../../lib/notes/chain/privateCommentMessages'
import { preparePrivateCommentRequest, recoverPrivateCommentIntent } from '../../../../lib/notes/chain/privateCommentRequest'
import { readPrivateCommentPage } from '../../../../lib/notes/chain/privateComments'
import { gnotAmount } from '../../../../lib/notes/chain/quote'
import { NotesChainError, type ChainNote } from '../../../../lib/notes/chain/schema'
import { newNoteId, notesDeployment, privateNotesDeployment } from '../../../../lib/notes/config'
import { encodeComment } from '../../../../lib/notes/crypto/comment'
import { padmeLength } from '../../../../lib/notes/crypto/padding'
import { createDraftSession, type NotesStore } from '../../../../lib/notes/drafts'
import { announceNoteChange, withTimeout } from '../../../../lib/notes/freshness'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { NotesIntents, type NotesIntent } from '../../../../lib/notes/intents'
import { openPrivateComments, privateCommentQuote, sealPrivateComment } from '../../../../lib/notes/private/comments'
import { parseWrap } from '../../../../lib/notes/private/schema'
import { useSigner } from '../../../sign/signerContext'
import { PublicComments } from '../PublicComments'
import { useUnsavedText } from '../notesPane'
import { balanceOf, selectedQuote, shortAddress } from '../notesFormat'
import { withKey } from './keyQueue'
import { KEY_CHANGED } from './unlock'

export interface PrivateCommentPanelProps {
    note: ChainNote; client: NotesReadClient; controller: NotesIdentityController; owner: string; store: NotesStore; walletChainId?: string
    previewRoot?: HTMLElement | null; onCount?(count: number, more: boolean): void
}
type Post = { body: string; quote: string; parent?: string; bodyRevision: string }
const MAX_QUOTE = 280, unresolved = (intent: NotesIntent) => ['prepared', 'submitted', 'unknown'].includes(intent.phase)
class Refusal extends Error {}

/**
 * A private note's comments. The composer (unlocked, a reader of a Shared note) encrypts a comment and its quote with the
 * note's CURRENT key; each comment opens under the key of its own epoch, through this account's own envelope. The text
 * written stays in memory and goes with a lock. The author deletes a comment, the owner or a writer resolves one, the
 * owner hides one: none of these needs the key.
 */
export function PrivateCommentPanel(props: PrivateCommentPanelProps) {
    if (privateNotesDeployment(props.client.chainId)?.realm !== props.client.realm) return null
    return <Panel key={[props.client.chainId, props.client.realm, props.owner, props.note.id, props.note.epoch, props.note.mode, props.note.deleted].join(':')} {...props} />
}
function Panel({ note, client, controller, owner, store, walletChainId, previewRoot, onCount }: PrivateCommentPanelProps) {
    const signer = useSigner(), { phase, generation } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const [session] = useState(createDraftSession), unlocked = phase === 'unlocked'
    useLayoutEffect(() => () => session.invalidate(), [session])
    const [access, setAccess] = useState<{ generation: string; writer: boolean } | null | undefined>(undefined)
    const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [reload, refresh] = useState(0), working = useRef(false)
    const [receipts, setReceipts] = useState<NotesIntent[] | null>(null), [reply, setReply] = useState<PublicComment | null>(null)
    const realm = commentIntentRealm(client.realm, note.id)
    // This account's envelope of the current epoch (a public read): whether it may post, and resolve as a writer.
    useEffect(() => {
        let alive = true
        void withTimeout(client.wrapRaw(note.id, note.epoch, owner)).then(raw => { if (alive) setAccess(raw === null ? null : parseWrap(raw, note.epoch, owner)) }, () => { if (alive) setAccess(null) })
        return () => { alive = false }
    }, [client, note.id, note.epoch, owner])
    useEffect(() => {
        let alive = true
        void new NotesIntents(store).list({ chainId: client.chainId, realm, owner }).then(items => { if (alive) setReceipts(items.filter(unresolved)) },
            () => { if (alive) setNotice('Saved comment receipts could not be read. Posting stays blocked; nothing was resent.') })
        return () => { alive = false }
    }, [client, store, realm, owner, reload, signer.version])
    // As the realm: a Shared note's readers comment (owner and writers included); its owner and writers resolve; its owner hides.
    const canPost = unlocked && !!access && access.generation === generation && note.mode === 1 && !note.deleted
    const canResolve = !note.deleted && (note.owner === owner || !!access?.writer), canHide = !note.deleted && note.owner === owner
    // Only while unlocked: a lock hands PublicComments no function, which drops the text it opened.
    const decrypt = useMemo(() => !unlocked || !generation ? undefined : async (items: PublicComment[], cursor: string, signal: AbortSignal) => {
        const page = await readPrivateCommentPage(client, note.id, cursor)
        // Exactly the listed comments at the listed revisions; anything else stays a placeholder.
        const listed = page.filter(c => items.some(item => item.id === c.id && item.revision === c.revision))
        return withKey(controller, () => openPrivateComments(client, note.id, listed, { owner, identity: controller, signal }))
    }, [unlocked, generation, client, controller, note.id, owner])
    async function submit(action: PrivateCommentAction | Post, commentId: string, onPosted?: () => void) {
        if (working.current || receipts === null) return
        working.current = true; setBusy(true); setNotice('')
        const { signal } = session.capture(), lease = new AbortController()
        // A lock or another key while the request is prepared or waits refuses it before the wallet.
        const stop = controller.subscribe(() => { const now = controller.getSnapshot(); if (now.phase !== 'unlocked' || now.generation !== generation) lease.abort() })
        try {
            let chosen: PrivateCommentAction
            if ('body' in action) {
                if ((await withTimeout(new NotesIntents(store).list({ chainId: client.chainId, realm, owner }))).some(unresolved)) throw new Refusal('Check the unresolved comment receipt before posting again. Nothing was sent.')
                const fresh = await withTimeout(client.noteMetadata(note.id))
                if (!fresh || fresh.deleted || fresh.mode !== 1 || fresh.epoch !== note.epoch) throw new NotesChainError('stale')
                const meta = { id: commentId, author: owner, parent: action.parent ?? '', bodyRevision: action.bodyRevision, epoch: fresh.epoch }
                const ciphertext = await withKey(controller, () => sealPrivateComment(client, fresh, meta, { body: action.body, quote: action.quote, prefix: '', suffix: '' }, { owner, identity: controller, signal: lease.signal }))
                chosen = { kind: 'add', bodyRevision: meta.bodyRevision, epoch: meta.epoch, parent: action.parent, ciphertext }
            } else chosen = action
            const operation = { caller: owner, noteId: note.id, commentId, operationId: newNoteId(), action: chosen }
            const budget = privateCommentBudget(privateCommentMessage(operation, '0', client.realm)), cap = budget.suggestedCapUgnot
            // The wallet may need the whole cap and the fee: refused here, before any signature, when the balance is short.
            const [fee, balance] = await Promise.all([freshFeeForGasWanted(budget.gasWanted), balanceOf(client.chainId, owner)]), total = BigInt(cap) + BigInt(fee)
            if (balance !== null && balance < total) throw new Refusal(`This can cost up to ${gnotAmount(String(total))}; your balance is ${gnotAmount(String(balance))}. Nothing was sent.`)
            const request = await preparePrivateCommentRequest({ client, operation, maxDepositUgnot: cap, session, intents: new NotesIntents(store), quote: privateCommentQuote(client, cap),
                isWriteEnabled: () => !!notesDeployment(client.chainId), ...chosen.kind === 'add' ? { access: { owner, identity: controller, signal: lease.signal } } : {} })
            if (signal.aborted) { request.onDismissed?.(); return }
            const { onSettled, onDismissed } = request
            request.onDismissed = () => { stop(); onDismissed?.() }
            request.onSettled = (outcome, choice) => {
                stop(); onSettled?.(outcome, choice)
                if (outcome === 'confirmed') { onPosted?.(); announceNoteChange({ chainId: client.chainId, noteId: note.id }) }
                if (signal.aborted) return
                setNotice(outcome === 'confirmed' ? (chosen.kind === 'add' ? 'Encrypted comment posted.' : 'Comment action confirmed.')
                    : outcome === 'unknown' || outcome === 'submitted' ? 'Not confirmed yet: check the retained receipt before posting again. Nothing was resent.' : '')
                refresh(n => n + 1)
            }
            if (!signer.sign(request)) { request.onDismissed?.(); setNotice('The signature window could not open. Close any other signature request, then try again.') }
        } catch (error) {
            stop()
            if (!signal.aborted) setNotice(error instanceof Refusal ? error.message : error instanceof NotesChainError && error.code === 'session' ? 'Your private key was locked meanwhile. Nothing was sent.'
                : error instanceof NotesChainError && error.code === 'stale' ? 'The note or this comment changed on the network meanwhile. Nothing was sent; try again.' : 'The comment could not be prepared. Nothing was sent.')
        } finally { if (!signal.aborted) { working.current = false; setBusy(false) } }
    }
    async function checkOutcome(intent: NotesIntent) {
        if (working.current) return
        working.current = true; setBusy(true)
        const { signal } = session.capture(), result = await recoverPrivateCommentIntent(client, new NotesIntents(store), intent, session)
        if (signal.aborted) return
        setNotice(result === 'confirmed' ? 'Comment action confirmed.' : 'The outcome remains unknown. Nothing was resent.'); refresh(n => n + 1)
        working.current = false; setBusy(false)
    }
    const walletProblem = walletChainId && walletChainId !== client.chainId ? `Adena is on ${walletChainId}. Switch it to ${client.chainId} first.` : ''
    // Read only while the key changed outside Memba: no comment is deleted, hidden or resolved from here meanwhile.
    const disabled = busy || !!walletProblem || receipts === null || phase === 'changed'
    return <div className="os-notes-comment-panel">
        <div className="os-notes-comment-list">
            <PublicComments key={reload} encryptedNote decrypt={decrypt} client={client} noteId={note.id} epoch={note.epoch} bodyRevision={note.bodyRevision} viewer={owner} previewRoot={previewRoot}
                canResolve={canResolve} canHide={canHide} onCount={onCount} actionsDisabled={disabled} onReply={canPost ? setReply : undefined}
                onDelete={comment => void submit({ kind: 'delete', revision: comment.revision }, comment.id)}
                onResolve={(comment, resolved) => void submit({ kind: 'resolve', revision: comment.revision, resolved }, comment.id)}
                onHide={(comment, hidden) => void submit({ kind: 'hide', revision: comment.revision, hidden }, comment.id)} />
            {receipts?.map(intent => <div key={intent.operationId} className="os-notes-message"><p>A comment action you sent earlier has no confirmed outcome yet.</p>
                {intent.verification?.kind === 'private-comment-v1' ? <button className="os-btn" disabled={busy} onClick={() => void checkOutcome(intent)}>Check comment outcome</button> : <p>Its receipt was kept; nothing was resent.</p>}</div>)}
            {notice && <p role="status">{notice}</p>}
            {walletProblem && <p className="os-notes-field-error" role="alert">{walletProblem}</p>}
        </div>
        {/* Keyed by key generation: a lock or another key unmounts it, and the text written goes with it. */}
        {canPost ? <Composer key={generation} note={note} previewRoot={previewRoot} disabled={disabled || !!receipts?.length} busy={busy} reply={reply} onCancelReply={() => setReply(null)}
            onPost={(post, posted) => void submit(post, newNoteId(), posted)} />
            : !note.deleted && <p className="os-notes-composer-hint">{note.mode !== 1 ? 'Comments open once this note is shared: the people it is shared with can then comment, encrypted for each other.'
                : phase === 'changed' ? `${KEY_CHANGED} Its comments stay encrypted; Memba cannot read, post or change them with it.` : !unlocked ? 'Unlock your private key to read and write the comments.' : access === undefined ? 'Checking your access…' : 'Only the people this note is shared with can comment.'}</p>}
    </div>
}
function Composer({ note, previewRoot, disabled, busy, reply, onCancelReply, onPost }: { note: ChainNote; previewRoot?: HTMLElement | null; disabled: boolean; busy: boolean
    reply: PublicComment | null; onCancelReply(): void; onPost(post: Post, posted: () => void): void }) {
    const [body, setBody] = useState(''), [quote, setQuote] = useState<{ text: string; bodyRevision: string } | null>(null), [tooLong, setTooLong] = useState(false)
    useUnsavedText(!!body.trim(), 'An encrypted comment you wrote is not posted yet. Leave without posting it? Choose Cancel to keep editing.',
        'An encrypted comment you wrote is not posted yet, and locking discards it: it is never stored on this device. Lock anyway? Choose Cancel to keep it.')
    // Selecting text in the decrypted note quotes it; the quote is encrypted with the comment, never sent on its own.
    useEffect(() => {
        if (!previewRoot) return
        const take = () => {
            const text = selectedQuote(previewRoot)
            if (!text) return
            setTooLong([...text].length > MAX_QUOTE)
            if ([...text].length <= MAX_QUOTE) setQuote({ text, bodyRevision: note.bodyRevision })
        }
        previewRoot.addEventListener('mouseup', take); previewRoot.addEventListener('keyup', take)
        return () => { previewRoot.removeEventListener('mouseup', take); previewRoot.removeEventListener('keyup', take) }
    }, [previewRoot, note.bodyRevision])
    // Priced on the ciphertext length this text will have (header, nonce, PADMÉ padding, tag); null while it is not valid.
    const cost = useMemo(() => {
        if (!body.trim()) return null
        try { const plain = encodeComment({ body, quote: quote?.text ?? '', prefix: '', suffix: '' }), length = 55 + padmeLength(plain.length + 4); plain.fill(0); return encryptedCommentBudget(length) } catch { return null }
    }, [body, quote])
    const sent = { body, quote }
    return <form className="os-notes-composer" aria-label="Write an encrypted comment" onSubmit={event => {
        event.preventDefault()
        if (cost) onPost({ body, quote: quote?.text ?? '', parent: reply?.id, bodyRevision: quote?.bodyRevision ?? note.bodyRevision },
            () => { setBody(value => value === sent.body ? '' : value); setQuote(value => value === sent.quote ? null : value); onCancelReply() })
    }}>
        <p className="os-notes-composer-hint">{reply ? <>Reply to {shortAddress(reply.author)} <button type="button" className="os-btn os-quiet" onClick={onCancelReply}>Cancel reply</button></>
            : <>Encrypted for the people this note is shared with · select text in the note to quote it</>}</p>
        {quote && <figure className="os-notes-anchor"><blockquote>{quote.text}</blockquote>
            <figcaption>{quote.bodyRevision === note.bodyRevision ? 'Quote from the current text' : 'Quote from an earlier text'}, encrypted with the comment <button type="button" className="os-btn os-quiet" onClick={() => setQuote(null)}>Remove quote</button></figcaption></figure>}
        {tooLong && <p role="status">That selection is too long to quote. Select a shorter passage (up to {MAX_QUOTE} characters).</p>}
        <textarea aria-label="Encrypted comment" placeholder="Add an encrypted comment" rows={2} value={body} onChange={event => setBody(event.target.value)} maxLength={1000} />
        <div className="os-notes-composer-foot">
            <span className="os-notes-cost">{cost ? <>Signed with Adena · <b>≈ {approxGnot(cost.estimatedDepositUgnot)}</b><small>Storage deposit; deleting the comment returns part of it</small><small>At most {gnotAmount(cost.suggestedCapUgnot)}</small></> : 'Encrypted in this browser · signed with Adena'}</span>
            <button type="submit" className="os-btn" disabled={disabled || !cost}>{busy ? 'Encrypting…' : 'Comment'}</button>
        </div>
    </form>
}
