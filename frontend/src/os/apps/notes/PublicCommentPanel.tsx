import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type NotesStore } from '../../../lib/notes/drafts'
import { NotesIntents, type NotesIntent } from '../../../lib/notes/intents'
import { notesDeployment, newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import { publicCommentMessage, type CommentAction } from '../../../lib/notes/chain/commentMessages'
import { commentIntentRealm, preparePublicCommentRequest, recoverPublicCommentIntent } from '../../../lib/notes/chain/commentRequest'
import { publicCommentBudget, publicCommentQuote } from '../../../lib/notes/chain/commentQuote'
import { gnotAmount, parseGnotCap } from '../../../lib/notes/chain/quote'
import type { PublicComment } from '../../../lib/notes/chain/comments'
import { useSigner } from '../../sign/signerContext'
import { PublicComments } from './PublicComments'

type PublicCommentPanelProps = { note: ChainNote; client: NotesReadClient; owner: string | null; store: NotesStore; previewRoot?: HTMLElement | null }
export function PublicCommentPanel(props: PublicCommentPanelProps) {
    const { client, store } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    const n = props.note
    return <PublicCommentPanelSession key={JSON.stringify([lease.id, client.chainId, props.owner, n.id, n.owner, n.stateRevision, n.ownerGeneration, n.mode, n.deleted])} {...props} />
}
function PublicCommentPanelSession({ note, client, owner, store, previewRoot }: PublicCommentPanelProps) {
    const signer = useSigner(), [session] = useState(createDraftSession)
    const [body, setBody] = useState(''), [anchor, setAnchor] = useState(''), [cap, setCap] = useState('')
    const [parent, setParent] = useState<PublicComment | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
    const [receipts, setReceipts] = useState<NotesIntent[]>([]), [reload, refresh] = useState(0)
    const [receiptsReady, setReceiptsReady] = useState('')
    const receiptsKey = JSON.stringify([owner, note.id, signer.version, reload])
    const working = useRef(false)
    const realm = commentIntentRealm(note.id), canPost = !!owner && !note.deleted && note.mode === 4
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        const guard = session.capture(); let alive = true
        if (!owner) return
        void new NotesIntents(store).list({ chainId: client.chainId, realm, owner }).then(items => {
            if (alive && !guard.signal.aborted) { setReceipts(items.filter(item => ['prepared', 'submitted', 'unknown'].includes(item.phase))); setReceiptsReady(receiptsKey) }
        }).catch(() => { if (alive && !guard.signal.aborted) setNotice('Saved comment receipts could not be read. No comment was resent.') })
        return () => { alive = false }
    }, [client, store, realm, owner, receiptsKey, session])
    async function review(action: CommentAction, commentId = newNoteId()) {
        if (!owner || working.current || receiptsReady !== receiptsKey || (action.kind === 'add' && !canPost)) return
        working.current = true
        const guard = session.capture(); setBusy(true); setNotice('')
        try {
            if (action.kind === 'add') {
                const pending = await new NotesIntents(store).list({ chainId: client.chainId, realm, owner })
                if (guard.signal.aborted) return
                if (pending.some(item => ['prepared', 'submitted', 'unknown'].includes(item.phase))) { setNotice('Check the unresolved comment receipt before posting again.'); refresh(value => value + 1); return }
            }
            const operation = { caller: owner, noteId: note.id, commentId, operationId: newNoteId(), action }
            const budget = publicCommentBudget(publicCommentMessage(operation, '0'))
            const amount = cap === '' ? budget.suggestedCapUgnot : parseGnotCap(cap)
            if (amount === null || BigInt(amount) < BigInt(budget.estimatedDepositUgnot)) { setNotice(`Enter a deposit cap of at least ${gnotAmount(budget.estimatedDepositUgnot)}.`); return }
            const common = { client, maxDepositUgnot: amount, session, intents: new NotesIntents(store), isWriteEnabled: () => !!notesDeployment(client.chainId) }
            const request = await preparePublicCommentRequest({ ...common, operation, quote: publicCommentQuote(client, amount) })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            const settle = request.onSettled
            request.onSettled = (outcome, choice) => {
                settle?.(outcome, choice)
                if (guard.signal.aborted) return
                if (outcome === 'confirmed') {
                    if (action.kind === 'add') { setBody(value => value === action.body ? '' : value); setAnchor(value => value === action.anchor ? '' : value); setParent(null) }
                    setNotice('Comment action confirmed.'); refresh(value => value + 1)
                } else if (outcome === 'unknown') { setNotice('Outcome unknown. Check the retained receipt before posting again.'); refresh(value => value + 1) }
            }
            if (!signer.sign(request)) request.onDismissed?.()
        } catch { if (!guard.signal.aborted) setNotice('The comment review could not be prepared. Check its length, permissions and current note revision.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    async function check(intent: NotesIntent) {
        if (working.current || intent.verification?.kind !== 'comment-v1') return
        working.current = true
        const guard = session.capture(); setBusy(true)
        try {
            const result = await recoverPublicCommentIntent(client, new NotesIntents(store), intent, session)
            if (guard.signal.aborted) return
            setNotice(result === 'confirmed' ? 'Comment action confirmed. The text in your composer was kept; compare it before posting again.' : 'The outcome remains unknown. Nothing was resent.')
            refresh(value => value + 1)
        } catch { if (!guard.signal.aborted) setNotice('The outcome could not be checked. The receipt was kept; nothing was resent.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    const actionsReady = !!owner && !busy && receiptsReady === receiptsKey
    return <div>
        <PublicComments previewRoot={previewRoot} key={reload} client={client} noteId={note.id} epoch={note.epoch} bodyRevision={note.bodyRevision} viewer={owner}
            allowEncryptedActions={false} canResolve={!note.deleted && owner === note.owner} canHide={!note.deleted && owner === note.owner}
            onReply={canPost ? comment => { setParent(comment); setNotice('Reply selected. The quote and body revision are shown before signing.') } : undefined}
            onDelete={actionsReady ? comment => void review({ kind: 'delete', revision: comment.revision }, comment.id) : undefined}
            onResolve={actionsReady ? (comment, resolved) => void review({ kind: 'resolve', revision: comment.revision, resolved }, comment.id) : undefined}
            onHide={actionsReady ? (comment, hidden) => void review({ kind: 'hide', revision: comment.revision, hidden }, comment.id) : undefined} />
        {canPost && <details className="os-notes-publish" open={!!parent || undefined}><summary>Write a public comment</summary><div>
            {parent && <p>Reply to {parent.author} <button className="os-btn os-quiet" onClick={() => setParent(null)}>Cancel reply</button></p>}
            <label>Quoted passage (optional)<textarea value={anchor} onChange={event => setAnchor(event.target.value)} maxLength={600} /></label>
            <label>Comment<textarea value={body} onChange={event => setBody(event.target.value)} maxLength={4000} /></label>
            <p className="os-sub">Up to 1,000 characters / 4,000 UTF-8 bytes. Public forever in chain history. The composer stays in memory until this note closes.</p>
            <label>Maximum storage deposit (GNOT)<input inputMode="decimal" value={cap} onChange={event => setCap(event.target.value)} placeholder="Use suggested cap" /></label>
            <button className="os-btn" disabled={busy || !body.trim() || !!receipts.length || receiptsReady !== receiptsKey} onClick={() => void review({ kind: 'add', bodyRevision: note.bodyRevision, epoch: note.epoch, parent: parent?.id, anchor, body })}>Review comment</button>
        </div></details>}
        {!owner && !note.deleted && note.mode === 4 && <p>Connect your wallet to comment.</p>}
        {receipts.map(intent => <div key={intent.operationId}><p>Unresolved comment operation {intent.operationId}</p>{intent.verification?.kind === 'comment-v1'
            ? <button className="os-btn" disabled={busy} onClick={() => void check(intent)}>Check comment outcome</button>
            : <p>This saved operation is not supported in this public view. Its receipt was kept; nothing was resent.</p>}</div>)}
        {notice && <p role="status">{notice}</p>}
    </div>
}
