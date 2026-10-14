import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type NotesStore } from '../../../lib/notes/drafts'
import { NotesIntents } from '../../../lib/notes/intents'
import { newNoteId, notesDeployment } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { PublicCapabilities } from '../../../lib/notes/chain/capabilities'
import { publicNoteMessage } from '../../../lib/notes/chain/messages'
import { gnotAmount, publicNoteBudget, publicNoteQuote } from '../../../lib/notes/chain/quote'
import { approxGnot } from '../../../lib/notes/chain/costText'
import { preparePublicNoteRequest } from '../../../lib/notes/chain/request'
import { NotesChainError, type ChainNote } from '../../../lib/notes/chain/schema'
import { announceNoteChange } from '../../../lib/notes/freshness'
import { useSigner } from '../../sign/signerContext'

type Props = { note: ChainNote; client: NotesReadClient; store: NotesStore; owner: string | null; hidden?: boolean; onChanged(): void }
type Done = { text: string; ok: boolean } | null
/** Pricing only: a setting's storage does not depend on the operation identifier's value. */
const PRICE_ID = 'f1'.repeat(16)

/**
 * "Who can edit" in the Share menu. The owner of an open public note chooses between only
 * themselves and every wallet (SetPublicWrites), sees the cost before signing, and follows the
 * change to its confirmation here. Everyone else sees the current setting, read-only.
 */
export function PublicCollaborationControls(props: Props) {
    const { note, client, store, owner, hidden } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    // The outcome outlives the remount that follows the confirmed change.
    const [done, setDone] = useState<Done>(null)
    if (note.deleted || note.mode < 3 || hidden) return null
    if (note.mode === 3) return <section className="os-notes-share-part" aria-label="Who can edit">
        <h3 className="os-notes-share-k">Who can edit</h3>
        {/* As the realm's write check: owner, named writers, governance members of a governance-owned note, the write policy. */}
        <p>The owner, the writers the owner named, governance members when governance owns the note, and wallets the note's write policy allows.</p>
    </section>
    return <Controls key={JSON.stringify([lease.id, client.chainId, owner, note.id, note.owner, note.stateRevision, note.ownerGeneration, note.mode, note.epoch, note.deleted, note.listed])}
        {...props} manage={!!owner && owner === note.owner} done={done} setDone={setDone} />
}
function Controls({ note, client, store, owner, onChanged, manage, done, setDone }: Props & { manage: boolean; done: Done; setDone(value: Done): void }) {
    const [session] = useState(createDraftSession), working = useRef(false)
    const [capability, setCapability] = useState<PublicCapabilities | null>(null), [failed, setFailed] = useState(false)
    const [reload, retry] = useState(0), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false)
    const [notice, setNotice] = useState(''), [choice, setChoice] = useState<boolean | null>(null), [signing, setSigning] = useState(false)
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
    const enabled = capability?.allowPublicWrites ?? false, target = choice ?? enabled, changing = !!capability && target !== enabled
    const budget = useMemo(() => {
        if (!manage || !owner || !changing) return null
        try { return publicNoteBudget(publicNoteMessage({ caller: owner, noteId: note.id, operationId: PRICE_ID, action: { kind: 'public-writes', revision: note.stateRevision, enabled: target } }, '0', { realm: client.realm })) } catch { return null }
    }, [manage, owner, changing, note.id, note.stateRevision, target, client.realm])
    async function apply() {
        if (working.current || !capability || blocked || !owner || !changing || !budget) return
        working.current = true; setBusy(true); setNotice(''); setDone(null)
        const guard = session.capture(), wanted = target
        try {
            const current = await readCapability()
            if (guard.signal.aborted) return
            if (current.allowPublicWrites !== capability.allowPublicWrites) throw new NotesChainError('stale')
            const pending = await new NotesIntents(store).list({ chainId: client.chainId, realm: client.realm, owner })
            if (guard.signal.aborted) return
            if (pending.some(item => item.scope.noteId === note.id && ['prepared', 'submitted', 'unknown'].includes(item.phase))) {
                setBlocked(true); setNotice('An earlier change to this note has an unresolved receipt. Check it before another change; nothing was resent.'); return
            }
            const operation = { caller: owner, noteId: note.id, operationId: newNoteId(), action: { kind: 'public-writes' as const, revision: note.stateRevision, enabled: wanted } }
            const amount = budget.suggestedCapUgnot
            const request = await preparePublicNoteRequest({ client, operation, maxDepositUgnot: amount, draftLocalRevision: '0', session,
                intents: new NotesIntents(store), quote: publicNoteQuote(client, amount), isWriteEnabled: () => !!notesDeployment(client.chainId) })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            const settle = request.onSettled, dismissed = request.onDismissed
            request.onDismissed = () => { dismissed?.(); if (!guard.signal.aborted) setSigning(false) }
            request.onSettled = (outcome, choice) => {
                settle?.(outcome, choice)
                if (guard.signal.aborted) return
                setSigning(false)
                if (outcome === 'confirmed') {
                    setBlocked(true); setDone({ ok: true, text: wanted ? 'Editing is open: every wallet can now edit this note.' : 'Editing is closed: only you can edit this note now.' })
                    onChanged(); announceNoteChange({ chainId: client.chainId, noteId: note.id, stateRevision: (BigInt(note.stateRevision) + 1n).toString() })
                }
                else if (outcome === 'unknown') { setBlocked(true); setNotice('Outcome unknown. The operation receipt was kept. Check it before another change; nothing was resent.') }
                else if (outcome === 'submitted') { setBlocked(true); setNotice('Submitted, not yet seen on chain. The operation receipt was kept. Check it before another change; nothing was resent.') }
                else setNotice('Nothing changed. You can try again.')
            }
            if (signer.sign(request)) setSigning(true)
            else request.onDismissed?.()
        } catch { if (!guard.signal.aborted) setNotice('The permission or note changed, or an unresolved receipt exists. Refresh and check the receipt before preparing another change.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    const name = `edit-${note.id}`
    return <section className="os-notes-share-part" aria-label="Who can edit">
        {failed ? <><h3 className="os-notes-share-k">Who can edit</h3><p role="alert">Who can edit this note could not be checked.</p><button className="os-btn" onClick={() => retry(value => value + 1)}>Retry</button></>
            : !capability ? <><h3 className="os-notes-share-k">Who can edit</h3><p role="status">Checking who can edit…</p></>
            : manage ? <fieldset className="os-notes-share-options" disabled={busy || blocked || signing}>
                <legend className="os-notes-share-k">Who can edit</legend>
                <label className="os-notes-share-option"><input type="radio" name={name} checked={!target} onChange={() => setChoice(false)} />
                    <span>Only me<small>{enabled ? 'Community editing stops. Earlier edits stay in History.' : 'Current setting'}</small></span></label>
                <label className="os-notes-share-option"><input type="radio" name={name} checked={target} onChange={() => setChoice(true)} />
                    <span>Everyone with a wallet<small>{enabled ? 'Current setting' : 'Each edit is signed and kept in History. You can close editing at any time.'}</small></span></label>
            </fieldset>
            : <><h3 className="os-notes-share-k">Who can edit</h3><p>{enabled ? 'Everyone with a wallet. Each edit is signed and kept in History.' : 'Only the owner.'}</p></>}
        {manage && changing && <footer className="os-notes-share-foot">
            <p className="os-notes-cost">{budget ? <><b>≈ {approxGnot(budget.estimatedDepositUgnot)}</b> storage deposit {target ? 'to open editing' : 'to close editing'} <small>· at most {gnotAmount(budget.suggestedCapUgnot)}, plus the network fee</small></> : 'This change cannot be priced right now.'}</p>
            <div className="os-notes-share-actions">
                <button className="os-btn os-quiet" disabled={busy || signing} onClick={() => { setChoice(null); setNotice('') }}>Cancel</button>
                <button className="os-btn" disabled={busy || blocked || signing || !budget} onClick={() => void apply()}>{busy ? 'Preparing…' : 'Apply with Adena'}</button>
            </div>
        </footer>}
        {signing && <p className="os-notes-share-progress" role="status"><span className="os-spin" aria-hidden="true" /> Waiting for your signature in the review sheet and Adena…</p>}
        {done && <p className="os-notes-share-done" role="status"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg> {done.text}</p>}
        {notice && <p role="status">{notice}</p>}
    </section>
}
