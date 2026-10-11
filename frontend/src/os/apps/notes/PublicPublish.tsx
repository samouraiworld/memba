import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type DraftRecord, type NotesStore } from '../../../lib/notes/drafts'
import { NotesIntents } from '../../../lib/notes/intents'
import { notesDeployment, newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { changedPublicFields, draftPublicOperation } from '../../../lib/notes/chain/draftOperation'
import { publicNoteMessage } from '../../../lib/notes/chain/messages'
import { gnotAmount, parseGnotCap, publicNoteBudget, publicNoteQuote } from '../../../lib/notes/chain/quote'
import { preparePublicNoteRequest } from '../../../lib/notes/chain/request'
import { NotesChainError, type ChainNote } from '../../../lib/notes/chain/schema'
import { announceNoteChange, NotesTimeoutError, withTimeout } from '../../../lib/notes/freshness'
import { publicBodyProblem, publicTitleProblem } from '../../../lib/notes/publicFields'
import { useSigner } from '../../sign/signerContext'

type PublicPublishProps = {
    draft: DraftRecord; client: NotesReadClient; store: NotesStore
    /** Resolves true when the saved draft already follows the latest revision (it may rebase it otherwise). */
    beforeReview?(): Promise<boolean>
    /** The verified note at the revision this publication created. */
    onPublished?(note: ChainNote): void
}
function failure(error: unknown): string {
    if (error instanceof NotesChainError && error.code === 'unchanged') return 'Nothing to publish: the title and body match the published note.'
    if (error instanceof NotesTimeoutError) return 'The network did not answer in time. Nothing was signed and your text is kept. Try again.'
    if (error instanceof NotesChainError && error.code === 'stale') return 'Someone published a newer version, or your draft changed, while the review was prepared. Your text is kept. Select Review publication again to update it first.'
    if (error instanceof NotesChainError && error.code === 'network') return 'This draft belongs to another network or Notes deployment. Switch back to it to publish. Your text is kept.'
    if (error instanceof NotesChainError && error.code === 'disabled') return 'Publishing is not available on this network right now. Your text is kept.'
    if (error instanceof NotesChainError && error.code === 'storage') return 'This device could not record the operation. Nothing was signed and your text is kept.'
    return 'A safe publication review could not be prepared. Check the title (no leading or trailing spaces, no “/”, at most 80 characters) and the network, then try again. Your text is kept.'
}
export function PublicPublish(props: PublicPublishProps) {
    const { client, store } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    return <PublicPublishSession key={JSON.stringify([lease.id, client.chainId, props.draft.scope.chainId, props.draft.scope.realm, props.draft.scope.owner, props.draft.scope.noteId, props.draft.localRevision])} {...props} />
}
function PublicPublishSession({ draft, client, store, beforeReview, onPublished }: PublicPublishProps) {
    const signer = useSigner()
    const [session] = useState(createDraftSession)
    const [mode, setMode] = useState<3 | 4>(3)
    const [cap, setCap] = useState('')
    const [busy, setBusy] = useState(false), working = useRef(false)
    const [notice, setNotice] = useState('')
    useLayoutEffect(() => () => session.invalidate(), [session])
    const update = draft.payload.kind === 'public' && !!draft.payload.base
    async function review() {
        if (working.current) return
        working.current = true
        const guard = session.capture()
        setBusy(true); setNotice('')
        try {
            const invalid = draft.payload.kind === 'public' ? publicTitleProblem(draft.payload.title) ?? publicBodyProblem(draft.payload.body) : null
            if (invalid) { setNotice(invalid); return }
            client.assertCurrent()
            if (client.chainId !== draft.scope.chainId || notesDeployment(client.chainId)?.realm !== draft.scope.realm) throw new NotesChainError('network')
            // A stale draft is rebased (or its conflict shown) by the editor before anything is prepared.
            if (beforeReview && !await withTimeout(beforeReview())) return
            if (guard.signal.aborted) return
            const config = await withTimeout(client.config())
            if (guard.signal.aborted) return
            let operation = draftPublicOperation(draft, newNoteId(), mode, config.createFeeUgnot)
            if (operation.action.kind === 'commit') {
                // Price and send only the fields that differ from the published revision.
                const published = await withTimeout(client.note(draft.scope.noteId))
                if (guard.signal.aborted) return
                if (!published || published.stateRevision !== operation.action.revision) throw new NotesChainError('stale')
                operation = changedPublicFields(operation, published)
            }
            const budget = publicNoteBudget(publicNoteMessage(operation, '0', config))
            const amount = cap === '' ? budget.suggestedCapUgnot : parseGnotCap(cap)
            if (amount === null || BigInt(amount) < BigInt(budget.estimatedDepositUgnot)) {
                setNotice(`Enter a deposit cap of at least ${gnotAmount(budget.estimatedDepositUgnot)}.`); return
            }
            // Another tab may have changed the local draft during quote preparation.
            const durable = await withTimeout(store.getDraft(draft.scope))
            if (guard.signal.aborted) return
            if (!durable || durable.localRevision !== draft.localRevision) throw new NotesChainError('stale')
            let confirmed: ChainNote | null = null
            const pending = preparePublicNoteRequest({ client, operation, maxDepositUgnot: amount, draftLocalRevision: draft.localRevision,
                session, intents: new NotesIntents(store), quote: publicNoteQuote(client, amount), isWriteEnabled: () => !!notesDeployment(client.chainId),
                onConfirmed: note => { confirmed = note } })
            // A late request after a timeout is dismissed; it has recorded nothing and opened no wallet.
            const request = await withTimeout(pending).catch(error => { void pending.then(late => late.onDismissed?.(), () => {}); throw error })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            const settle = request.onSettled
            request.onSettled = (outcome, choice) => {
                settle?.(outcome, choice)
                if (outcome === 'confirmed') {
                    const note = confirmed as ChainNote | null
                    announceNoteChange({ chainId: draft.scope.chainId, noteId: draft.scope.noteId, ...(note ? { stateRevision: note.stateRevision } : {}) })
                    if (note) onPublished?.(note)
                }
                if (guard.signal.aborted) return
                if (outcome === 'confirmed') setNotice(confirmed ? `Published as revision ${(confirmed as ChainNote).stateRevision}.` : 'Publication confirmed.')
                else if (outcome === 'unknown') setNotice('The outcome is unknown. Your draft and operation receipt were kept. Check the receipt before another attempt.')
            }
            request.warns = [...request.warns ?? [], 'Storage and gas are conservative estimates. A refused execution can still consume its transaction fee.']
            if (signer.sign(request)) setNotice('Review the publication and its spending limits in the signature sheet.')
            else { request.onDismissed?.(); setNotice('The signature window could not open. Close any other signature request, then select Review publication again. Your text is kept.') }
        } catch (error) {
            if (!guard.signal.aborted) setNotice(failure(error))
        } finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    return <details className="os-notes-publish"><summary>{update ? 'Publish changes' : 'Publish'}</summary>
        <div><p>This publishes the saved title and body for everyone to read. Earlier versions remain in chain history.</p>
            {!update && <label>Comments <select value={mode} onChange={event => setMode(Number(event.target.value) as 3 | 4)} disabled={busy}><option value={3}>Restricted to writers</option><option value={4}>Open to everyone</option></select></label>}
            <label>Maximum storage deposit (GNOT)<input inputMode="decimal" value={cap} onChange={event => setCap(event.target.value)} placeholder="Use suggested cap" disabled={busy} /></label>
            <p className="os-sub">The review shows the estimated deposit, cap, publication fee and network fee before you sign.</p>
            <button className="os-btn" disabled={busy} onClick={() => void review()}>{busy ? 'Preparing review…' : 'Review publication'}</button>
            {notice && <p role="status">{notice}</p>}
        </div>
    </details>
}
