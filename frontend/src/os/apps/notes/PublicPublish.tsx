import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type DraftRecord, type NotesStore } from '../../../lib/notes/drafts'
import { NotesIntents } from '../../../lib/notes/intents'
import { notesDeployment, newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { draftPublicOperation } from '../../../lib/notes/chain/draftOperation'
import { publicNoteMessage } from '../../../lib/notes/chain/messages'
import { gnotAmount, parseGnotCap, publicNoteBudget, publicNoteQuote } from '../../../lib/notes/chain/quote'
import { preparePublicNoteRequest } from '../../../lib/notes/chain/request'
import { NotesChainError } from '../../../lib/notes/chain/schema'
import { useSigner } from '../../sign/signerContext'

type PublicPublishProps = { draft: DraftRecord; client: NotesReadClient; store: NotesStore }
export function PublicPublish(props: PublicPublishProps) {
    const { client, store } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    return <PublicPublishSession key={JSON.stringify([lease.id, client.chainId, props.draft.scope.chainId, props.draft.scope.realm, props.draft.scope.owner, props.draft.scope.noteId, props.draft.localRevision])} {...props} />
}
function PublicPublishSession({ draft, client, store }: PublicPublishProps) {
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
            client.assertCurrent()
            if (client.chainId !== draft.scope.chainId || notesDeployment(client.chainId)?.realm !== draft.scope.realm) throw new NotesChainError('stale')
            const config = await client.config()
            if (guard.signal.aborted) return
            const operation = draftPublicOperation(draft, newNoteId(), mode, config.createFeeUgnot)
            const budget = publicNoteBudget(publicNoteMessage(operation, '0', config))
            const amount = cap === '' ? budget.suggestedCapUgnot : parseGnotCap(cap)
            if (amount === null || BigInt(amount) < BigInt(budget.estimatedDepositUgnot)) {
                setNotice(`Enter a deposit cap of at least ${gnotAmount(budget.estimatedDepositUgnot)}.`); return
            }
            // Another tab may have changed the local draft during quote preparation.
            const durable = await store.getDraft(draft.scope)
            if (guard.signal.aborted) return
            if (!durable || durable.localRevision !== draft.localRevision) throw new NotesChainError('stale')
            const request = await preparePublicNoteRequest({ client, operation, maxDepositUgnot: amount, draftLocalRevision: draft.localRevision,
                session, intents: new NotesIntents(store), quote: publicNoteQuote(client, amount), isWriteEnabled: () => !!notesDeployment(client.chainId) })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            const settle = request.onSettled
            request.onSettled = (outcome, choice) => {
                settle?.(outcome, choice)
                if (guard.signal.aborted) return
                if (outcome === 'confirmed') setNotice('Publication confirmed. Your draft baseline was kept. Compare with the published revision before another update.')
                else if (outcome === 'unknown') setNotice('The outcome is unknown. Your draft and operation receipt were kept. Check the receipt before another attempt.')
            }
            request.warns = [...request.warns ?? [], 'Storage and gas are conservative estimates. A refused execution can still consume its transaction fee.']
            if (signer.sign(request)) setNotice('Review the publication and its spending limits in the signature sheet.')
            else request.onDismissed?.()
        } catch (error) {
            if (!guard.signal.aborted) setNotice(error instanceof NotesChainError && error.code === 'stale'
                ? 'The draft, published note or quote changed. Your edits were kept. Refresh and compare before publishing.'
                : 'A safe publication review could not be prepared. Check the title, network and local storage, then try again.')
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
