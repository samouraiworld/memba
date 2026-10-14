import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type DraftRecord, type DraftSession, type NotesStore } from '../../../lib/notes/drafts'
import { NotesIntents } from '../../../lib/notes/intents'
import { notesDeployment, newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { changedPublicFields, draftPublicOperation } from '../../../lib/notes/chain/draftOperation'
import { publicNoteMessage, type PublicNoteOperation } from '../../../lib/notes/chain/messages'
import { gnotAmount, publicNoteBudget, publicNoteQuote } from '../../../lib/notes/chain/quote'
import { preparePublicNoteRequest } from '../../../lib/notes/chain/request'
import { NotesChainError, publicText, type ChainNote } from '../../../lib/notes/chain/schema'
import { announceNoteChange, NotesTimeoutError, withTimeout } from '../../../lib/notes/freshness'
import { publicBodyProblem, publicTitleProblem, trimPublicTitle } from '../../../lib/notes/publicFields'
import { abciQueryText } from '../../../lib/dao/packageStatus'
import { ugnotInCoinsJson } from '../../../lib/bankBalance'
import { getRpcUrlsInOrder } from '../../../lib/rpcFallback'
import type { SettledOutcome, SignRequest } from '../../sign/signer'
import { useSigner, type SignerApi } from '../../sign/signerContext'
import { NoteSheet, type Notice } from './NoteHeader'
import { PUBLISHING, useNotesPane, type NotesPane } from './notesPane'

/** Where a signed publication stands. The workspace shows it: it outlives the control that started it. */
export interface PublishProgress { kind: 'publish' | 'delete'; title: string; chainId: string; step: 'approve' | 'sending' | 'done'; revision?: string; walletSince?: number }
type Report = { onProgress?(progress: PublishProgress | null): void; onNotice?(notice: Notice | null): void }
type PublicPublishProps = Report & {
    draft: DraftRecord; client: NotesReadClient; store: NotesStore
    /**
     * Lifetime of the signing request (send, verification, receipt). Owned by the workspace so typing,
     * which remounts this control, never cancels the confirmation of a transaction already signed.
     */
    requestSession?: DraftSession
    /** Resolves the verified latest note when the saved draft follows it; null when it explained why not (rebase, conflict, lag). */
    beforeReview?(): Promise<ChainNote | null>
    /** The verified note at the revision this publication created. */
    onPublished?(note: ChainNote): void
    titleProblem?(message: string): void
    /** The network Adena is on, when known. */
    walletChainId?: string
}
const kept = 'Your text is kept.'
function failure(error: unknown): Notice {
    if (error instanceof NotesChainError && error.code === 'unchanged') return { tone: 'info', text: 'Nothing to publish: the title and body match the published note.' }
    if (error instanceof NotesTimeoutError) return { tone: 'warn', title: 'The network did not answer in time.', text: `Nothing was sent. ${kept} Try again in a moment.` }
    if (error instanceof NotesChainError && error.code === 'network') return { tone: 'error', text: `This draft belongs to another network or Notes deployment. Switch back to it to publish. ${kept}` }
    if (error instanceof NotesChainError && error.code === 'disabled') return { tone: 'error', text: `Publishing is not available on this network right now. ${kept}` }
    if (error instanceof NotesChainError && error.code === 'storage') return { tone: 'error', text: `This device could not record the publication, so nothing was sent. ${kept}` }
    if (error instanceof NotesChainError && error.code === 'stale') return { tone: 'warn', text: `Your draft changed in another window, or the note changed, while the publication was prepared. Nothing was sent. ${kept} Press Publish again.` }
    return { tone: 'error', text: `The publication could not be prepared. Nothing was sent. ${kept} Try again.` }
}
const unresolved = (title: string): Notice => ({ tone: 'pending', title: 'Result not known yet.', text: `An earlier publication of “${title}” has not been confirmed. Do not publish again: check its result first. ${kept}` })
function outcomeNotice(outcome: SettledOutcome, kind: PublishProgress['kind'], revision: string): Notice | null {
    const what = kind === 'delete' ? 'deletion' : 'publication'
    if (outcome === 'cancelled') return { tone: 'warn', title: 'Cancelled in Adena.', text: `Nothing was sent. ${kind === 'delete' ? 'The note is unchanged.' : 'Your text is still here.'}` }
    if (outcome === 'failed') return { tone: 'error', title: `The network refused this ${what}.`, text: `It did not take effect; the reason is in Notifications. ${kind === 'delete' ? '' : kept}`.trim() }
    if (outcome === 'unknown') return { tone: 'pending', title: 'Result not known yet.', text: `The network did not confirm in time. Do not ${kind === 'delete' ? 'delete' : 'publish'} again: check whether revision ${revision} exists first. ${kind === 'delete' ? '' : kept}`.trim() }
    if (outcome === 'submitted') return { tone: 'pending', title: 'Sent, not visible yet.', text: `The network has not shown revision ${revision} yet; it usually appears within a minute. Do not send it again.` }
    return null
}
/** One line per field: what this publication stores, in words. */
function changeLines(operation: PublicNoteOperation, published: ChainNote | null): string[] {
    const a = operation.action
    if (a.kind === 'create') return [`A new note: its title and ${count(a.body.split('\n').length, 'line')} of text.`]
    if (a.kind !== 'commit') return []
    const lines: string[] = []
    if (a.title === undefined) lines.push('Title unchanged, so it is not stored again.')
    else lines.push(`Title: “${published ? publicText(published.title, true) : ''}” → “${a.title}”.`)
    if (a.body === undefined) lines.push('Body unchanged, so it is not stored again.')
    else {
        const before = published?.body ? publicText(published.body).split('\n') : [], after = a.body.split('\n')
        let start = 0, end = 0
        while (start < before.length && start < after.length && before[start] === after[start]) start++
        while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
        const removed = before.length - start - end, added = after.length - start - end
        lines.push(`Body: ${removed === 0 ? `${count(added, 'line')} added` : added === 0 ? `${count(removed, 'line')} removed` : `${count(Math.max(added, removed), 'line')} changed`}.`)
    }
    return lines
}
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const fieldMask = (a: PublicNoteOperation['action']) => a.kind !== 'commit' ? null : a.title !== undefined && a.body !== undefined ? 'title and body (mask 3)' : a.title !== undefined ? 'title only (mask 1)' : 'body only (mask 2)'
async function balanceOf(chainId: string, address: string): Promise<bigint | null> {
    const urls = getRpcUrlsInOrder()
    return withTimeout(abciQueryText({ chainId, rpcUrl: urls[0], rpcUrls: urls }, `bank/balances/${address}`, '').then(ugnotInCoinsJson), 5000).catch(() => null)
}

/**
 * Hands a prepared request to the OS signature sheet and reports its progress. The note pane stays
 * mounted (hidden) until it settles, so the confirmation and baseline move complete after switching notes.
 */
function sign(request: SignRequest, context: Report & { signer: SignerApi; pane: NotesPane | null; kind: PublishProgress['kind']; title: string; chainId: string; noteId: string; revision: string; confirmed(): ChainNote | null; onConfirmed?(note: ChainNote): void }): boolean {
    const { onProgress, onNotice, kind, title, chainId, revision } = context
    const progress = (step: PublishProgress['step'], extra: Partial<PublishProgress> = {}) => onProgress?.({ kind, title, chainId, step, ...extra })
    const hold = `${PUBLISHING}${newNoteId()}`, release = () => context.pane?.hold(hold, false)
    const { send, onSettled, onDismissed } = request
    request.send = async (choice, beforeSign) => {
        progress('approve', { walletSince: Date.now() })
        const result = await send(choice, beforeSign)
        progress('sending')
        return result
    }
    request.onSettled = (outcome, choice) => {
        try {
            onSettled?.(outcome, choice)
            const note = context.confirmed()
            if (outcome === 'confirmed') {
                announceNoteChange({ chainId, noteId: context.noteId, ...(note ? { stateRevision: note.stateRevision } : {}) })
                if (note) context.onConfirmed?.(note)
                progress('done', { revision: note?.stateRevision ?? revision })
            } else { onProgress?.(null); onNotice?.(outcomeNotice(outcome, kind, revision)) }
        } finally { release() }
    }
    request.onDismissed = () => {
        try { onDismissed?.(); onProgress?.(null); onNotice?.({ tone: 'info', text: kind === 'delete' ? 'Deletion cancelled. Nothing was sent.' : `Publication cancelled. Nothing was sent. ${kept}` }) } finally { release() }
    }
    context.pane?.hold(hold, true)
    if (!context.signer.sign(request)) {
        request.onDismissed()
        onNotice?.({ tone: 'warn', text: `The signature window could not open. Close any other signature request, then try again. ${kind === 'delete' ? '' : kept}`.trim() })
        return false
    }
    progress('approve')
    return true
}

type Review = { operation: PublicNoteOperation; published: ChainNote | null; expected: string; cap: string; fee: string; balance: bigint | null }
type Sheet = { phase: 'closed' } | { phase: 'preparing' } | { phase: 'review'; review: Review } | { phase: 'signing'; review: Review }
export function PublicPublish(props: PublicPublishProps) {
    const { client, store } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    return <PublicPublishSession key={JSON.stringify([lease.id, client.chainId, props.draft.scope.chainId, props.draft.scope.realm, props.draft.scope.owner, props.draft.scope.noteId, props.draft.localRevision])} {...props} />
}
/** Publish: a sheet in the window says what changes, who sees it and what it costs, then Adena signs. */
function PublicPublishSession({ draft, client, store, requestSession, beforeReview, onPublished, onProgress, onNotice, titleProblem, walletChainId }: PublicPublishProps) {
    const pane = useNotesPane(), signer = useSigner()
    const [session] = useState(createDraftSession), working = useRef(false)
    const [sheet, setSheet] = useState<Sheet>({ phase: 'closed' })
    const [mode, setMode] = useState<3 | 4>(3), [details, setDetails] = useState(false), [copied, setCopied] = useState(false)
    useLayoutEffect(() => () => session.invalidate(), [session])
    const payload = draft.payload.kind === 'public' ? draft.payload : null
    const title = payload ? trimPublicTitle(payload.title) : ''
    async function review() {
        if (working.current || !payload) return
        const invalid = publicTitleProblem(payload.title)
        if (invalid) { titleProblem?.(invalid); return }
        const body = publicBodyProblem(payload.body)
        if (body) { onNotice?.({ tone: 'error', text: `${body} ${kept}` }); return }
        working.current = true
        const guard = session.capture()
        onNotice?.(null); setSheet({ phase: 'preparing' })
        try {
            client.assertCurrent()
            if (client.chainId !== draft.scope.chainId || notesDeployment(client.chainId)?.realm !== draft.scope.realm) throw new NotesChainError('network')
            const receipts = await withTimeout(new NotesIntents(store).list({ chainId: draft.scope.chainId, realm: draft.scope.realm, owner: draft.scope.owner }))
            if (guard.signal.aborted) return
            if (receipts.some(item => item.scope.noteId === draft.scope.noteId && ['prepared', 'submitted', 'unknown'].includes(item.phase))) { setSheet({ phase: 'closed' }); onNotice?.(unresolved(title)); return }
            // A stale draft is rebased (or its conflict shown) by the editor before anything is prepared.
            let published: ChainNote | null = null
            if (payload.base && beforeReview) {
                published = await withTimeout(beforeReview())
                if (guard.signal.aborted) return
                if (!published) { setSheet({ phase: 'closed' }); return }
            }
            const config = await withTimeout(client.config())
            if (guard.signal.aborted) return
            let operation = draftPublicOperation(draft, newNoteId(), mode, config.createFeeUgnot)
            // Price and send only the fields that differ from the published revision the editor just verified.
            if (operation.action.kind === 'commit') {
                if (!published || published.stateRevision !== operation.action.revision) throw new NotesChainError('stale')
                operation = changedPublicFields(operation, published)
            }
            const budget = publicNoteBudget(publicNoteMessage(operation, '0', config))
            // Another tab may have changed the local draft meanwhile.
            const [durable, balance] = await Promise.all([withTimeout(store.getDraft(draft.scope)), balanceOf(client.chainId, draft.scope.owner)])
            if (guard.signal.aborted) return
            if (!durable || durable.localRevision !== draft.localRevision) throw new NotesChainError('stale')
            const fee = operation.action.kind === 'create' ? config.createFeeUgnot : '0'
            setSheet({ phase: 'review', review: { operation, published, expected: budget.estimatedDepositUgnot, cap: budget.suggestedCapUgnot, fee, balance } })
        } catch (error) {
            if (!guard.signal.aborted) { setSheet({ phase: 'closed' }); onNotice?.(failure(error)) }
        } finally { if (!guard.signal.aborted) working.current = false }
    }
    async function publish(current: Review) {
        if (working.current) return
        working.current = true
        const guard = session.capture()
        setSheet({ phase: 'signing', review: current })
        const operation: PublicNoteOperation = current.operation.action.kind === 'create' ? { ...current.operation, action: { ...current.operation.action, mode } } : current.operation
        try {
            let confirmed: ChainNote | null = null
            const pending = preparePublicNoteRequest({ client, operation, maxDepositUgnot: current.cap, draftLocalRevision: draft.localRevision,
                session: requestSession ?? session, intents: new NotesIntents(store), quote: publicNoteQuote(client, current.cap), isWriteEnabled: () => !!notesDeployment(client.chainId),
                onConfirmed: note => { confirmed = note } })
            // A late request after a timeout is dismissed; it has recorded nothing and opened no wallet.
            const request = await withTimeout(pending).catch(error => { void pending.then(late => late.onDismissed?.(), () => {}); throw error })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            const next = String(BigInt(operation.action.kind === 'create' ? '0' : operation.action.revision) + 1n)
            request.title = operation.action.kind === 'create' ? 'Publish note' : 'Publish changes'
            request.summary = `Publish “${title}”`
            request.sub = changeLines(operation, current.published).join(' ')
            setSheet({ phase: 'closed' })
            sign(request, { signer, pane, kind: 'publish', title, chainId: client.chainId, noteId: draft.scope.noteId, revision: next, confirmed: () => confirmed, onConfirmed: onPublished, onProgress, onNotice })
        } catch (error) {
            if (guard.signal.aborted) return
            setSheet({ phase: 'closed' })
            // A refused base is explained by the editor's own check: a newer revision, a lagging node or a closed note.
            if (error instanceof NotesChainError && error.code === 'stale' && beforeReview && payload?.base) {
                const latest = await withTimeout(beforeReview()).catch(() => null)
                if (latest && !guard.signal.aborted) onNotice?.(failure(error))
            } else onNotice?.(failure(error))
        } finally { if (!guard.signal.aborted) working.current = false }
    }
    const close = () => { if (sheet.phase !== 'signing') { session.invalidate(); working.current = false; setSheet({ phase: 'closed' }) } }
    const shown = sheet.phase === 'review' || sheet.phase === 'signing' ? sheet.review : null
    const wrongNetwork = !!walletChainId && walletChainId !== client.chainId
    const short = shown && shown.balance !== null && shown.balance < BigInt(shown.expected) + BigInt(shown.fee)
    const a = shown?.operation.action
    return <>
        <button type="button" className="os-btn" disabled={sheet.phase !== 'closed'} onClick={() => void review()}>Publish</button>
        {sheet.phase === 'preparing' && <NoteSheet label="Publish" onClose={close}>
            <div className="os-notes-sheet-wait" role="status"><span className="os-spin" aria-hidden="true" />Checking the latest revision…</div>
            <div className="os-notes-sheet-actions"><button type="button" className="os-btn os-quiet" onClick={close}>Keep editing</button></div>
        </NoteSheet>}
        {shown && a && <NoteSheet label="Publish" onClose={close}>
            <h2>{a.kind === 'create' ? `Publish “${title}”?` : `Publish your changes to “${title}”?`}</h2>
            <dl className="os-notes-facts">
                <div><dt>What changes</dt><dd>{changeLines(shown.operation, shown.published).map(line => <span key={line}>{line}</span>)}</dd></div>
                <div><dt>Who sees it</dt><dd>{a.kind === 'create' ? 'Everyone with the link, and the public notes list. It becomes revision 1.'
                    : `Everyone. This becomes revision ${BigInt(a.kind === 'commit' ? a.revision : '0') + 1n}; earlier revisions stay in History.`}</dd></div>
                <div><dt>Cost</dt><dd><strong className="os-notes-cost">≈ {gnotAmount(shown.expected)}</strong> storage deposit{shown.fee !== '0' && <> plus a {gnotAmount(shown.fee)} publication fee</>}
                    <small>At most {gnotAmount(shown.cap)}, written in the transaction. Adena shows the network fee.</small></dd></div>
            </dl>
            {a.kind === 'create' && <fieldset className="os-notes-choices">
                <legend>Visibility</legend>
                <label><input type="radio" name="visibility" checked readOnly /> Public · everyone can read</label>
                <label><input type="radio" name="visibility" disabled /> Private · encrypted, only you <small>Not available yet</small></label>
                <label className="os-notes-select">Who can comment<select value={mode} disabled={sheet.phase === 'signing'} onChange={event => setMode(Number(event.target.value) as 3 | 4)}>
                    <option value={3}>Only people who can edit</option><option value={4}>Everyone</option></select></label>
            </fieldset>}
            {wrongNetwork && <p className="os-notes-field-error" role="alert"><b>Adena is on {walletChainId}, this note lives on {client.chainId}.</b> Switch Adena to {client.chainId}, then publish. {kept}</p>}
            {short && <p className="os-notes-field-error" role="alert"><b>This costs ≈ {gnotAmount(String(BigInt(shown.expected) + BigInt(shown.fee)))}; your balance is {gnotAmount(String(shown.balance!))}.</b> Nothing was sent. {kept}{' '}
                <button type="button" className="os-btn os-quiet" onClick={() => void navigator.clipboard?.writeText(draft.scope.owner).then(() => setCopied(true), () => {})}>{copied ? 'Address copied' : 'Copy my address'}</button></p>}
            <button type="button" className="os-notes-link" aria-expanded={details} onClick={() => setDetails(value => !value)}>{details ? 'Hide technical details' : 'Technical details'}</button>
            {details && <dl className="os-notes-tech">
                <div><dt>Realm</dt><dd>{client.realm} · {a.kind === 'create' ? 'CreateNote' : 'Commit'}</dd></div>
                <div><dt>Note</dt><dd>{draft.scope.noteId}</dd></div>
                {a.kind === 'commit' && <div><dt>Based on</dt><dd>revision {a.revision} · fields: {fieldMask(a)}</dd></div>}
                <div><dt>Network</dt><dd>{client.chainId}</dd></div>
            </dl>}
            <div className="os-notes-sheet-actions">
                <button type="button" className="os-btn os-quiet" disabled={sheet.phase === 'signing'} onClick={close}>Keep editing</button>
                <button type="button" className="os-btn" disabled={sheet.phase === 'signing' || wrongNetwork || !!short} onClick={() => void publish(shown)}>{sheet.phase === 'signing' ? 'Preparing…' : 'Publish with Adena'}</button>
            </div>
        </NoteSheet>}
    </>
}

/**
 * Deletes a published note (owner only): the same sheet as a publication says what it costs, checks Adena's network
 * and the balance, then signs. The request lives in the page's session, so closing this sheet never aborts it.
 */
export function PublicDelete({ note, client, store, owner, title, requestSession, walletChainId, onClose, onProgress, onNotice }: Report & {
    note: ChainNote; client: NotesReadClient; store: NotesStore; owner: string; title: string; requestSession: DraftSession; walletChainId?: string; onClose(): void
}) {
    const pane = useNotesPane(), signer = useSigner()
    const [session] = useState(createDraftSession), [busy, setBusy] = useState(false)
    // Priced once; each attempt gets its own operation id.
    const operation = useMemo<PublicNoteOperation>(() => ({ caller: owner, noteId: note.id, operationId: newNoteId(), action: { kind: 'delete', revision: note.stateRevision } }), [owner, note.id, note.stateRevision])
    const budget = useMemo(() => publicNoteBudget(publicNoteMessage(operation, '0', { realm: client.realm })), [operation, client.realm])
    const [balance, setBalance] = useState<bigint | null | undefined>(undefined)
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        const guard = session.capture()
        void balanceOf(client.chainId, owner).then(value => { if (!guard.signal.aborted) setBalance(value) })
    }, [session, client.chainId, owner])
    const wrongNetwork = !!walletChainId && walletChainId !== client.chainId
    const short = typeof balance === 'bigint' && balance < BigInt(budget.estimatedDepositUgnot)
    async function remove() {
        if (busy || wrongNetwork || short) return
        setBusy(true)
        const guard = session.capture()
        try {
            const pending = preparePublicNoteRequest({ client, operation: { ...operation, operationId: newNoteId() }, maxDepositUgnot: budget.suggestedCapUgnot, draftLocalRevision: '0', session: requestSession, intents: new NotesIntents(store),
                quote: publicNoteQuote(client, budget.suggestedCapUgnot), isWriteEnabled: () => !!notesDeployment(client.chainId) })
            // A late request after a timeout is dismissed; it has recorded nothing and opened no wallet.
            const request = await withTimeout(pending).catch(error => { void pending.then(late => late.onDismissed?.(), () => {}); throw error })
            if (guard.signal.aborted) { request.onDismissed?.(); return }
            request.summary = `Delete “${title}”`
            onClose()
            sign(request, { signer, pane, kind: 'delete', title, chainId: client.chainId, noteId: note.id, revision: String(BigInt(note.stateRevision) + 1n), confirmed: () => null, onProgress, onNotice })
        } catch (error) {
            if (!guard.signal.aborted) { onClose(); onNotice?.(error instanceof NotesChainError && error.code === 'stale' ? { tone: 'warn', text: 'The note changed meanwhile. Nothing was sent; read the latest revision first.' } : { ...failure(error), text: failure(error).text.replace(` ${kept}`, '') }) }
        } finally { if (!guard.signal.aborted) setBusy(false) }
    }
    return <NoteSheet label="Delete note" onClose={busy ? undefined : onClose}>
        <h2>Delete “{title}”?</h2>
        <dl className="os-notes-facts">
            <div><dt>What happens</dt><dd>Readers will see that the note was deleted. Earlier versions remain in chain history, and comments stay as they are. This cannot be undone.</dd></div>
            <div><dt>Cost</dt><dd><strong className="os-notes-cost">≈ {gnotAmount(budget.estimatedDepositUgnot)}</strong> storage deposit, not returned: deleting records the deletion in the note&apos;s history.
                <small>At most {gnotAmount(budget.suggestedCapUgnot)}, written in the transaction. Adena shows the network fee.</small></dd></div>
        </dl>
        {wrongNetwork && <p className="os-notes-field-error" role="alert"><b>Adena is on {walletChainId}, this note lives on {client.chainId}.</b> Switch Adena to {client.chainId}, then delete.</p>}
        {short && <p className="os-notes-field-error" role="alert"><b>This costs ≈ {gnotAmount(budget.estimatedDepositUgnot)}; your balance is {gnotAmount(String(balance))}.</b> Nothing was sent.</p>}
        <div className="os-notes-sheet-actions">
            <button type="button" className="os-btn os-quiet" disabled={busy} onClick={onClose}>Keep the note</button>
            <button type="button" className="os-btn os-notes-danger" disabled={busy || wrongNetwork || short} onClick={() => void remove()}>{busy ? 'Preparing…' : 'Delete with Adena'}</button>
        </div>
    </NoteSheet>
}

const STEPS = [['Review', ''], ['Approve in Adena', 'Check the request in the signature sheet, then in your Adena window. Nothing is sent until you approve.'], ['Sending', 'Waiting for the next block, usually a few seconds.'], ['Published', '']] as const
/** In-window progress of a signed publication: Review → Approve in Adena → Sending → Published. */
export function PublishProgressSheet({ progress, onHide, onView }: { progress: PublishProgress; onHide(): void; onView(): void }) {
    const [now, setNow] = useState(() => Date.now())
    const since = progress.step === 'approve' ? progress.walletSince : undefined
    useEffect(() => {
        if (since === undefined) return
        const timer = setTimeout(() => setNow(Date.now()), Math.max(0, since + 30_000 - Date.now()))
        return () => clearTimeout(timer)
    }, [since])
    const deleted = progress.kind === 'delete'
    if (progress.step === 'done') return <NoteSheet label={deleted ? 'Deleted' : 'Published'} onClose={onView}>
        <div className="os-notes-done">
            <svg className="os-notes-check" viewBox="0 0 100 100" role="img" aria-label={deleted ? 'Deleted' : 'Published'}><circle cx="50" cy="50" r="45" /><path d="M30 52 l13 13 l27 -28" /></svg>
            <h2>{deleted ? 'Deleted' : 'Published'}{progress.revision ? ` · revision ${progress.revision}` : ''}</h2>
            <p>{deleted ? 'Readers now see that this note was deleted.' : 'Everyone now sees your change. History and comments are up to date.'}</p>
            <button type="button" className="os-btn" autoFocus onClick={onView}>View note</button>
        </div>
    </NoteSheet>
    const at = progress.step === 'approve' ? 1 : 2, silent = since !== undefined && now - since >= 30_000
    const steps = deleted ? STEPS.map(([label, help], i) => [i === 3 ? 'Deleted' : label, help] as const) : STEPS
    return <NoteSheet label={deleted ? 'Deleting' : 'Publishing'} onClose={onHide}>
        <h2>{deleted ? 'Deleting' : 'Publishing'} “{progress.title}”</h2>
        <ol className="os-notes-steps">{steps.map(([label, help], i) => <li key={label} data-step={i < at ? 'done' : i === at ? 'active' : 'pending'} aria-current={i === at ? 'step' : undefined}>
            <span className="os-notes-step-mark" aria-hidden="true">{i === at && <span className="os-spin" />}</span>
            <div><b>{i === 2 ? `${label} to ${progress.chainId}` : label}</b>
                {i === at && <span>{i === 1 && silent ? 'No answer from Adena after 30 seconds. Adena may be locked or its window hidden. Nothing is sent until you approve.' : help}</span>}</div>
        </li>)}</ol>
        <div className="os-notes-sheet-actions"><span className="os-notes-hint">{deleted ? 'You can keep reading meanwhile.' : 'Your text stays saved on this device.'}</span><button type="button" className="os-btn os-quiet" onClick={onHide}>Hide</button></div>
    </NoteSheet>
}
