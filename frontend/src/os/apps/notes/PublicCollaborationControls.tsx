import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type NotesStore } from '../../../lib/notes/drafts'
import { NotesIntents } from '../../../lib/notes/intents'
import { newNoteId, notesDeployment } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { PublicCapabilities } from '../../../lib/notes/chain/capabilities'
import { publicNoteMessage } from '../../../lib/notes/chain/messages'
import { gnotAmount, parseGnotCap, publicNoteBudget, publicNoteQuote } from '../../../lib/notes/chain/quote'
import { preparePublicNoteRequest } from '../../../lib/notes/chain/request'
import { NotesChainError, type ChainNote } from '../../../lib/notes/chain/schema'
import { useSigner } from '../../sign/signerContext'

type Props = { note: ChainNote; client: NotesReadClient; store: NotesStore; owner: string | null; hidden?: boolean; onChanged(): void }
export function PublicCollaborationControls(props: Props) {
    const { note, client, store, owner, hidden } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    if (!owner || owner !== note.owner || note.mode !== 4 || note.deleted || hidden) return null
    return <Controls key={JSON.stringify([lease.id, client.chainId, owner, note.id, note.owner, note.stateRevision, note.ownerGeneration, note.mode, note.epoch, note.deleted, note.listed, hidden])} {...props} owner={owner} />
}
function Controls({ note, client, store, owner, onChanged }: Props & { owner: string }) {
    const [session] = useState(createDraftSession), working = useRef(false)
    const [capability, setCapability] = useState<PublicCapabilities | null>(null), [failed, setFailed] = useState(false)
    const [reload, retry] = useState(0), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false)
    const [notice, setNotice] = useState(''), [cap, setCap] = useState('')
    const signer = useSigner()
    useLayoutEffect(() => () => session.invalidate(), [session])
    async function readCapability() {
        client.assertCurrent()
        const value = await client.publicCapabilities(note.id)
        client.assertCurrent()
        if (!value || value.id !== note.id || value.stateRevision !== note.stateRevision || value.ownerGeneration !== note.ownerGeneration
            || value.mode !== note.mode || value.deleted !== note.deleted) throw new NotesChainError('stale')
        return value
    }
    useEffect(() => {
        const guard = session.capture(); let alive = true
        void readCapability().then(value => { if (alive && !guard.signal.aborted) { setCapability(value); setFailed(false) } })
            .catch(() => { if (alive && !guard.signal.aborted) { setCapability(null); setFailed(true) } })
        return () => { alive = false }
        // The keyed session fixes note, account, client and store for this lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload, session])
    async function review() {
        if (working.current || !capability || blocked) return
        working.current = true; setBusy(true); setNotice('')
        const guard = session.capture(), enabled = !capability.allowPublicWrites
        try {
            const current = await readCapability()
            if (guard.signal.aborted) return
            if (current.allowPublicWrites !== capability.allowPublicWrites) throw new NotesChainError('stale')
            const operation = { caller: owner, noteId: note.id, operationId: newNoteId(), action: { kind: 'public-writes' as const, revision: note.stateRevision, enabled } }
            const budget = publicNoteBudget(publicNoteMessage(operation, '0'))
            const amount = cap === '' ? budget.suggestedCapUgnot : parseGnotCap(cap)
            if (amount === null || BigInt(amount) < BigInt(budget.estimatedDepositUgnot)) { setNotice(`Enter a deposit cap of at least ${gnotAmount(budget.estimatedDepositUgnot)}.`); return }
            const request = await preparePublicNoteRequest({ client, operation, maxDepositUgnot: amount, draftLocalRevision: '0', session,
                intents: new NotesIntents(store), quote: publicNoteQuote(client, amount), isWriteEnabled: () => !!notesDeployment(client.chainId) })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            const settle = request.onSettled
            request.onSettled = (outcome, choice) => {
                settle?.(outcome, choice)
                if (guard.signal.aborted) return
                if (outcome === 'confirmed') { setBlocked(true); setNotice('Community editing change confirmed. Refreshing the published note.'); onChanged() }
                else if (outcome === 'unknown') { setBlocked(true); setNotice('Outcome unknown. The operation receipt was kept. Check it before another change; nothing was resent.') }
            }
            if (signer.sign(request)) setNotice(enabled ? 'Review allowing every connected wallet to edit this note.' : 'Review stopping public editing of this note.')
            else request.onDismissed?.()
        } catch { if (!guard.signal.aborted) setNotice('The permission or note changed, or an unresolved receipt exists. Refresh and check the receipt before preparing another change.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    return <section className="os-notes-publish" aria-label="Community editing settings">
        <h3>Community editing</h3>
        <p>Only the owner can change this setting. It grants content editing, not comment moderation or ownership.</p>
        {failed ? <><p role="alert">Community editing permissions could not be verified.</p><button className="os-btn" onClick={() => retry(value => value + 1)}>Retry permissions</button></>
            : !capability ? <p role="status">Checking community editing permissions…</p> : <>
                <p>{capability.allowPublicWrites ? 'Every connected wallet can edit this note.' : 'Public content editing is disabled.'}</p>
                <label>Maximum permission-change deposit (GNOT)<input value={cap} inputMode="decimal" onChange={event => setCap(event.target.value)} placeholder="Use suggested cap" disabled={busy || blocked} /></label>
                <button className="os-btn" disabled={busy || blocked} onClick={() => void review()}>{capability.allowPublicWrites ? 'Review stopping public editing' : 'Review allowing everyone to edit'}</button>
            </>}
        {notice && <p role="status">{notice}</p>}
    </section>
}
