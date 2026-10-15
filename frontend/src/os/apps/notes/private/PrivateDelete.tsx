import { useEffect, useLayoutEffect, useState } from 'react'
import { accessBudget, accessQuote } from '../../../../lib/notes/chain/accessQuote'
import { accessMessage, type AccessOperation } from '../../../../lib/notes/chain/accessMessages'
import { prepareAccessRequest } from '../../../../lib/notes/chain/accessRequest'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { gnotAmount } from '../../../../lib/notes/chain/quote'
import { NotesChainError, type ChainNote } from '../../../../lib/notes/chain/schema'
import { newNoteId, notesDeployment } from '../../../../lib/notes/config'
import { createDraftSession, type NotesStore } from '../../../../lib/notes/drafts'
import { NotesTimeoutError, withTimeout } from '../../../../lib/notes/freshness'
import { NotesIntents } from '../../../../lib/notes/intents'
import { freshFeeForGasWanted } from '../../../../lib/grc20'
import { useSigner } from '../../../sign/signerContext'
import { NoteSheet } from '../NoteHeader'
import { useNotesPane } from '../notesPane'
import { balanceOf } from '../notesFormat'
import { sign, type NoteReport } from '../PublicPublish'
import { afterConfirmed } from './encryptedDraft'

/** M0 rows 8: Delete returns 40-50 % of what the note locked; Purge (not offered yet) would free the rest but a tombstone. */
const DELETE_REFUND = 'Delete returns about half of what this note locked; the rest stays locked.'
/** Deleting a private note (owner only): the realm marks it deleted and returns part of its deposit to the caller. */
export function PrivateDelete({ note, client, store, owner, walletChainId, report, onClose }: {
    note: ChainNote; client: NotesReadClient; store: NotesStore; owner: string; walletChainId?: string; report?: NoteReport; onClose(): void
}) {
    const signer = useSigner(), pane = useNotesPane(), [session] = useState(createDraftSession)
    const [busy, setBusy] = useState(false), [problem, setProblem] = useState(''), [costs, setCosts] = useState<{ fee: number | null; balance: bigint | null; draft: string | null } | null>(null)
    const scope = { chainId: client.chainId, realm: client.realm, owner, noteId: note.id }
    const operation = (): AccessOperation => ({ caller: owner, noteId: note.id, operationId: newNoteId(), revision: note.stateRevision, ownerGeneration: note.ownerGeneration, action: { kind: 'delete' } })
    const budget = accessBudget(accessMessage(operation(), client.realm, '0'))
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        const guard = session.capture()
        // This device's encrypted draft of the note, read before the review: it is removed once the deletion is confirmed.
        void Promise.all([freshFeeForGasWanted(budget.gasWanted).catch(() => null), balanceOf(client.chainId, owner), withTimeout(store.getDraft(scope)).catch(() => null)])
            .then(([fee, balance, draft]) => { if (!guard.signal.aborted) setCosts({ fee, balance, draft: draft?.payload.kind === 'encrypted' ? draft.localRevision : null }) })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- One review per note revision (the sheet is keyed by it).
    }, [session, client, owner, store])
    const wrongNetwork = !!walletChainId && walletChainId !== client.chainId
    // As the other private flows: against the written maximum (the deposit cap) plus the network fee.
    const total = BigInt(budget.suggestedCapUgnot) + BigInt(costs?.fee ?? 0), short = !!costs && costs.balance !== null && costs.balance < total
    async function remove() {
        if (busy || !costs || wrongNetwork || short) return
        setBusy(true); setProblem('')
        const guard = session.capture()
        try {
            const pending = prepareAccessRequest({ client, operation: operation(), maxDepositUgnot: budget.suggestedCapUgnot, draftLocalRevision: costs.draft ?? '0',
                // The request outlives this sheet (it closes when the signature sheet opens): never this sheet's session.
                session: report?.requestSession ?? createDraftSession(),
                intents: new NotesIntents(store), quote: accessQuote(client, budget.suggestedCapUgnot), isWriteEnabled: () => !!notesDeployment(client.chainId) })
            const request = await withTimeout(pending).catch(error => { void pending.then(late => late.onDismissed?.(), () => {}); throw error })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            const draft = costs.draft
            if (draft) afterConfirmed(request, () => withTimeout(store.deleteDraft(scope, draft, createDraftSession())))
            onClose()
            sign(request, { signer, pane, kind: 'delete', title: 'Private note', chainId: client.chainId, noteId: note.id, revision: String(BigInt(note.stateRevision) + 1n), confirmed: () => null, onProgress: report?.onProgress, onNotice: report?.onNotice })
        } catch (error) {
            if (!guard.signal.aborted) setProblem(error instanceof NotesChainError && error.code === 'stale' ? 'The note changed meanwhile. Nothing was sent; read the latest revision first.'
                : error instanceof NotesChainError && error.code === 'disabled' ? 'Private notes are not available on this network right now. Nothing was sent.'
                : error instanceof NotesTimeoutError ? 'The network did not answer in time. Nothing was sent. Try again in a moment.' : 'The deletion could not be prepared. Nothing was sent.')
        } finally { if (!guard.signal.aborted) setBusy(false) }
    }
    return <NoteSheet label="Delete private note" onClose={busy ? undefined : onClose}>
        <h2>Delete this private note?</h2>
        <dl className="os-notes-facts">
            <div><dt>What happens</dt><dd>The note is marked deleted on the network and nobody can open it in Memba anymore. Its earlier encrypted versions stay in chain history, and anyone it was shared with keeps what they already read. This cannot be undone.</dd></div>
            <div><dt>Cost</dt><dd><strong className="os-notes-cost">{DELETE_REFUND}</strong>
                <small>No deposit is taken (the transaction allows at most {gnotAmount(budget.suggestedCapUgnot)}). Network fee at most {costs?.fee == null ? 'what Adena shows' : gnotAmount(costs.fee)}; Adena usually charges less.</small></dd></div>
            {costs?.draft && <div><dt>On this device</dt><dd>Your encrypted draft of this note is removed from this device once the deletion is confirmed.</dd></div>}
        </dl>
        {wrongNetwork && <p className="os-notes-field-error" role="alert"><b>Adena is on {walletChainId}, this note lives on {client.chainId}.</b> Switch Adena to {client.chainId}, then delete.</p>}
        {short && <p className="os-notes-field-error" role="alert"><b>This can cost up to {gnotAmount(String(total))}; your balance is {gnotAmount(String(costs!.balance))}.</b> Nothing was sent.</p>}
        {problem && <p className="os-notes-field-error" role="alert">{problem}</p>}
        <div className="os-notes-sheet-actions">
            <button type="button" className="os-btn os-quiet" disabled={busy} onClick={onClose}>Keep the note</button>
            <button type="button" className="os-btn os-notes-danger" disabled={busy || !costs || wrongNetwork || short} onClick={() => void remove()}>{busy ? 'Preparing…' : 'Delete with Adena'}</button>
        </div>
    </NoteSheet>
}
