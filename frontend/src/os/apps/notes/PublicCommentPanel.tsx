import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type NotesStore } from '../../../lib/notes/drafts'
import { NotesIntents, type NotesIntent } from '../../../lib/notes/intents'
import { notesDeployment, newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { publicText, type ChainNote } from '../../../lib/notes/chain/schema'
import { announceNoteChange, useNoteFreshness, withTimeout } from '../../../lib/notes/freshness'
import { publicCommentMessage, type CommentAction } from '../../../lib/notes/chain/commentMessages'
import { commentIntentRealm, preparePublicCommentRequest, recoverPublicCommentIntent } from '../../../lib/notes/chain/commentRequest'
import { publicCommentBudget, publicCommentQuote } from '../../../lib/notes/chain/commentQuote'
import { gnotAmount } from '../../../lib/notes/chain/quote'
import { approxGnot } from '../../../lib/notes/chain/costText'
import type { PublicComment } from '../../../lib/notes/chain/comments'
import { commentPosted, holdSentComment, isPostedComment, mergeReturned, settleSentComment, subscribeCommentText, takeCommentDraft, writeCommentDraft, type StoredCommentDraft } from '../../../lib/notes/commentDraftStorage'
import { useSigner } from '../../sign/signerContext'
import { PublicComments } from './PublicComments'
import { useUnsavedText } from './notesPane'

type PublicCommentPanelProps = {
    note: ChainNote; client: NotesReadClient; owner: string | null; store: NotesStore; previewRoot?: HTMLElement | null
    /** Comments on the first page and whether more follow, for a "Comments · N" label. */
    onCount?(count: number, more: boolean): void
}
type Quote = StoredCommentDraft['quote']
const NO_QUOTE: Quote = { text: '', bodyRevision: '', confirmedFor: '' }
const MAX_QUOTE_BYTES = 600
/** Pricing only: a comment's storage does not depend on its identifiers' values. */
const PRICE_ID = 'f1'.repeat(16)
const short = (address: string) => address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address

export function PublicCommentPanel(props: PublicCommentPanelProps) {
    const { client, store } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    return <PublicCommentScope key={JSON.stringify([lease.id, client.chainId, props.owner, props.note.id])} {...props} />
}
function useCommentDraft(chainId: string, owner: string | null, noteId: string) {
    // An unsent comment survives a lock, an account or network switch and a reload in this tab (session storage only).
    const scope = useMemo(() => owner ? { chainId, owner, noteId } : null, [chainId, owner, noteId])
    const [initial] = useState(() => scope ? takeCommentDraft(scope) : null)
    const [body, setBody] = useState(initial?.body ?? '')
    const [quote, setQuote] = useState<Quote>(initial?.quote ?? NO_QUOTE)
    const [parent, setParent] = useState<PublicComment | null>(null)
    /** Survives the session remount that follows a note refresh. */
    const [carried, setCarried] = useState('')
    /** Bumped when a comment for this note was sent, posted or given back in this tab: receipts are read again. */
    const [changed, setChanged] = useState(0)
    const current = useRef({ body, quote })
    useLayoutEffect(() => { current.current = { body, quote } }, [body, quote])
    useEffect(() => { if (scope) writeCommentDraft(scope, { body, quote }) }, [scope, body, quote])
    // Sent text leaves this composer (also when another composer for the note sent it), and so does a posted comment's
    // (same body and quote digests). Text that was not posted comes back, above anything written meanwhile.
    useEffect(() => scope ? subscribeCommentText(scope, event => {
        const now = current.current
        if (event.kind === 'returned') {
            const merged = mergeReturned(now, event.draft)
            setBody(merged.body); setQuote(merged.quote); setParent(value => value ?? (event.draft.parent as PublicComment | null | undefined) ?? null)
        } else if (event.kind === 'sent' ? now.body === event.draft.body : isPostedComment(now, event.digests)) {
            const sentQuote = event.kind === 'sent' ? event.draft.quote.text : now.quote.text
            setBody(''); setQuote(value => value.text === sentQuote ? NO_QUOTE : value); setParent(null)
        }
        setChanged(value => value + 1)
    }) : undefined, [scope])
    return { scope, body, setBody, quote, setQuote, parent, setParent, carried, setCarried, changed }
}
function PublicCommentScope(props: PublicCommentPanelProps) {
    const n = props.note, draft = useCommentDraft(props.client.chainId, props.owner, n.id)
    useUnsavedText(!!draft.body.trim(), 'A comment you wrote is not posted yet. Leave without posting it? Choose Cancel to keep editing.')
    return <PublicCommentPanelSession key={JSON.stringify([n.owner, n.stateRevision, n.ownerGeneration, n.mode, n.epoch, n.deleted])} {...props} draft={draft} />
}
/** Text selected inside the note, when the selection lies entirely in it. */
function selectedQuote(root: HTMLElement): string | null {
    const selection = root.ownerDocument.defaultView?.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return null
    const text = selection.toString().trim()
    return text || null
}
function PublicCommentPanelSession({ note, client, owner, store, previewRoot, onCount, draft }: PublicCommentPanelProps & { draft: ReturnType<typeof useCommentDraft> }) {
    const signer = useSigner(), [session] = useState(createDraftSession)
    const { body, setBody, quote, setQuote, parent, setParent, carried, setCarried } = draft
    // A quote still found verbatim in the current body follows it to the current body revision.
    const anchor = quote.text, current = !!anchor && !!note.body && !note.deleted && publicText(note.body).includes(anchor)
    const quoteRevision = anchor && current ? note.bodyRevision : quote.bodyRevision
    const quoteNeedsReview = !!anchor && quoteRevision !== note.bodyRevision && quote.confirmedFor !== note.bodyRevision
    const [fresh, setFresh] = useState(0)
    useNoteFreshness(client.chainId, note.id, useCallback(() => setFresh(value => value + 1), []))
    const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
    const [receipts, setReceipts] = useState<NotesIntent[]>([]), [reload, refresh] = useState(0)
    const [receiptsReady, setReceiptsReady] = useState('')
    const receiptsKey = JSON.stringify([owner, note.id, signer.version, reload, draft.changed])
    const working = useRef(false)
    const realm = commentIntentRealm(client.realm, note.id), canPost = !!owner && !note.deleted && note.mode === 4
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        const guard = session.capture(); let alive = true
        if (!owner) return
        void new NotesIntents(store).list({ chainId: client.chainId, realm, owner }).then(items => {
            if (alive && !guard.signal.aborted) { setReceipts(items.filter(item => ['prepared', 'submitted', 'unknown'].includes(item.phase))); setReceiptsReady(receiptsKey) }
        }).catch(() => { if (alive && !guard.signal.aborted) setNotice('Saved comment receipts could not be read. No comment was resent.') })
        return () => { alive = false }
    }, [client, store, realm, owner, receiptsKey, session])
    // Selecting text in the note quotes it in the composer (the anchor stays checked against the rendered note).
    // An existing quote is only replaced on an explicit choice.
    const [offer, setOffer] = useState('')
    useEffect(() => {
        if (!canPost || !previewRoot) return
        const take = () => {
            const text = selectedQuote(previewRoot)
            if (!text || text === anchor) return
            if (new TextEncoder().encode(text).length > MAX_QUOTE_BYTES) { setNotice('That selection is too long to quote. Select a shorter passage (up to 600 bytes).'); return }
            setNotice('')
            if (anchor) { setOffer(text); return }
            setQuote({ text, bodyRevision: note.bodyRevision, confirmedFor: note.bodyRevision })
        }
        previewRoot.addEventListener('mouseup', take); previewRoot.addEventListener('keyup', take)
        return () => { previewRoot.removeEventListener('mouseup', take); previewRoot.removeEventListener('keyup', take) }
    }, [canPost, previewRoot, note.bodyRevision, anchor, setQuote])
    const addAction = (): Extract<CommentAction, { kind: 'add' }> => ({ kind: 'add', bodyRevision: anchor ? quoteRevision : note.bodyRevision, epoch: note.epoch, parent: parent?.id, anchor, body })
    /** Expected deposit and the cap that is signed, from the quote module for this comment; null when it cannot be priced. Identifiers have a fixed size. */
    function budget(action: CommentAction) {
        if (!owner) return null
        try { return publicCommentBudget(publicCommentMessage({ caller: owner, noteId: note.id, commentId: PRICE_ID, operationId: PRICE_ID, action }, '0', client.realm)) } catch { return null }
    }
    async function review(action: CommentAction, commentId = newNoteId()) {
        if (!owner || working.current || receiptsReady !== receiptsKey || (action.kind === 'add' && (!canPost || quoteNeedsReview))) return
        working.current = true
        const guard = session.capture(); setBusy(true); setNotice(''); setCarried('')
        try {
            if (action.kind === 'add') {
                // Never anchor to a body revision the chain has already replaced.
                const latest = await withTimeout(client.note(note.id))
                if (guard.signal.aborted) return
                if (!latest || latest.deleted || latest.epoch !== note.epoch || BigInt(latest.bodyRevision) > BigInt(note.bodyRevision)) {
                    setCarried(latest && !latest.deleted ? `The note was updated to revision ${latest.stateRevision}. Your comment is kept: check it against the latest text, then send it again.` : 'The note changed on chain. Your comment is kept.')
                    announceNoteChange({ chainId: client.chainId, noteId: note.id, ...(latest ? { stateRevision: latest.stateRevision } : {}) })
                    return
                }
                const pending = await new NotesIntents(store).list({ chainId: client.chainId, realm, owner })
                if (guard.signal.aborted) return
                if (pending.some(item => ['prepared', 'submitted', 'unknown'].includes(item.phase))) { setNotice('Check the unresolved comment receipt before posting again.'); refresh(value => value + 1); return }
            }
            const priced = budget(action)
            if (!priced) throw new Error('Unpriced comment')
            const operation = { caller: owner, noteId: note.id, commentId, operationId: newNoteId(), action }
            const common = { client, maxDepositUgnot: priced.suggestedCapUgnot, session, intents: new NotesIntents(store), isWriteEnabled: () => !!notesDeployment(client.chainId) }
            const request = await preparePublicCommentRequest({ ...common, operation, quote: publicCommentQuote(client, priced.suggestedCapUgnot) })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            let settled = false
            const settle = request.onSettled, scope = draft.scope, sent = { body: action.kind === 'add' ? action.body : '', quote }
            if (action.kind === 'add' && scope) {
                // Sent is not confirmed, but from here the text must not be offered again: it is held aside until the outcome.
                const send = request.send, replyTo = parent
                request.send = async (choice, beforeSign) => {
                    const result = await send(choice, beforeSign)
                    // A hash the wallet returns after the outcome was given (the chain watch answered first) holds nothing.
                    if (!settled) holdSentComment(scope, operation.operationId, { ...sent, parent: replyTo })
                    return result
                }
            }
            request.onSettled = (outcome, choice) => {
                settled = true
                settle?.(outcome, choice)
                // Also when the review outlived the panel that started it (a note refresh remounted it, or the window closed).
                if (action.kind === 'add' && scope) settleSentComment(scope, operation.operationId, sent, outcome === 'confirmed')
                if (guard.signal.aborted) return
                if (outcome === 'confirmed') {
                    setNotice(action.kind === 'add' ? 'Comment posted.' : 'Comment action confirmed.'); refresh(value => value + 1)
                    announceNoteChange({ chainId: client.chainId, noteId: note.id })
                } else if (outcome === 'unknown') { setNotice('Outcome unknown. Check the retained receipt before posting again.'); refresh(value => value + 1) }
            }
            if (!signer.sign(request)) request.onDismissed?.()
        } catch { if (!guard.signal.aborted) setNotice('The comment could not be prepared. Your comment is kept. Check its length, your permissions and the network, then try again.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    async function check(intent: NotesIntent) {
        if (working.current || intent.verification?.kind !== 'comment-v1') return
        working.current = true
        const guard = session.capture(); setBusy(true)
        try {
            const result = await recoverPublicCommentIntent(client, new NotesIntents(store), intent, session)
            if (guard.signal.aborted) return
            const v = intent.verification, scope = draft.scope, posted = result === 'confirmed' && intent.action === 'addComment'
            const digests = { bodySha256: v.bodySha256, anchorSha256: v.anchorSha256 }, mine = posted && isPostedComment({ body, quote }, digests)
            // Every composer for the note holding the confirmed comment lets it go, not only this one: it is never posted twice.
            if (posted && scope) commentPosted(scope, digests, intent.operationId)
            setNotice(mine ? 'Comment posted. It was the text in your composer, which was cleared.'
                : result === 'confirmed' ? 'Comment action confirmed. The text in your composer was kept; compare it before posting again.' : 'The outcome remains unknown. Nothing was resent.')
            refresh(value => value + 1)
        } catch { if (!guard.signal.aborted) setNotice('The outcome could not be checked. The receipt was kept; nothing was resent.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    const actionsReady = !!owner && !busy && receiptsReady === receiptsKey
    const cost = canPost && body.trim() ? budget(addAction()) : null
    return <div className="os-notes-comment-panel">
        <div className="os-notes-comment-list">
            <PublicComments previewRoot={previewRoot} key={reload} refreshToken={fresh} client={client} noteId={note.id} epoch={note.epoch} bodyRevision={note.bodyRevision} viewer={owner}
                allowEncryptedActions={false} canResolve={!note.deleted && owner === note.owner} canHide={!note.deleted && owner === note.owner} onCount={onCount}
                onReply={canPost ? comment => { setParent(comment); setNotice('') } : undefined}
                onDelete={actionsReady ? comment => void review({ kind: 'delete', revision: comment.revision }, comment.id) : undefined}
                onResolve={actionsReady ? (comment, resolved) => void review({ kind: 'resolve', revision: comment.revision, resolved }, comment.id) : undefined}
                onHide={actionsReady ? (comment, hidden) => void review({ kind: 'hide', revision: comment.revision, hidden }, comment.id) : undefined} />
            {receipts.map(intent => <div key={intent.operationId} className="os-notes-message"><p>A comment you sent earlier has no confirmed outcome yet.</p>{intent.verification?.kind === 'comment-v1'
                ? <button className="os-btn" disabled={busy} onClick={() => void check(intent)}>Check comment outcome</button>
                : <p>This saved operation is not supported in this public view. Its receipt was kept; nothing was resent.</p>}</div>)}
            {carried && <p role="status">{carried}</p>}
            {notice && <p role="status">{notice}</p>}
        </div>
        {canPost && <form className="os-notes-composer" aria-label="Write a comment" onSubmit={event => { event.preventDefault(); void review(addAction()) }}>
            <p className="os-notes-composer-hint">{parent ? <>Reply to {short(parent.author)} <button type="button" className="os-btn os-quiet" onClick={() => setParent(null)}>Cancel reply</button></>
                : <>Comment on the current text (revision {note.stateRevision}) · select text in the note to quote it</>}</p>
            {anchor && <figure className="os-notes-anchor">
                <blockquote>{anchor}</blockquote>
                <figcaption>{quoteRevision === note.bodyRevision ? 'Quote from the current text' : 'Quote from an earlier text'} <button type="button" className="os-btn os-quiet" onClick={() => setQuote(NO_QUOTE)}>Remove quote</button></figcaption>
            </figure>}
            {offer && offer !== anchor && <p role="status">Replace the quote with “{[...offer].length > 60 ? `${[...offer].slice(0, 59).join('')}…` : offer}”?{' '}
                <button type="button" className="os-btn os-quiet" onClick={() => { setQuote({ text: offer, bodyRevision: note.bodyRevision, confirmedFor: note.bodyRevision }); setOffer('') }}>Replace quote</button>{' '}
                <button type="button" className="os-btn os-quiet" onClick={() => setOffer('')}>Keep current quote</button></p>}
            {quoteNeedsReview && <p role="status">The note changed and your quote is no longer in the latest text. Keep it anchored to the earlier text, or clear it. <button type="button" className="os-btn os-quiet" onClick={() => setQuote(value => ({ ...value, confirmedFor: note.bodyRevision }))}>Keep original quote</button> <button type="button" className="os-btn os-quiet" onClick={() => setQuote(NO_QUOTE)}>Clear quote</button></p>}
            <textarea aria-label="Comment" placeholder="Add a comment" rows={2} value={body} onChange={event => setBody(event.target.value)} maxLength={4000} />
            <div className="os-notes-composer-foot">
                <span className="os-notes-cost">{cost ? <>Signed with Adena · <b>≈ {approxGnot(cost.estimatedDepositUgnot)}</b><small>Storage deposit, not returned</small><small>At most {gnotAmount(cost.suggestedCapUgnot)}</small></> : 'Public, kept in chain history · signed with Adena'}</span>
                <button type="submit" className="os-btn" disabled={busy || quoteNeedsReview || !body.trim() || !!receipts.length || receiptsReady !== receiptsKey}>{busy ? 'Preparing…' : 'Comment'}</button>
            </div>
        </form>}
        {!owner && !note.deleted && note.mode === 4 && <p className="os-notes-composer-hint">Connect your wallet to comment.</p>}
    </div>
}
