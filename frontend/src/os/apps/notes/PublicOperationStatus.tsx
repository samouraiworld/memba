import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createDraftSession, type NotesPartition, type NotesStore } from '../../../lib/notes/drafts'
import { newNoteId } from '../../../lib/notes/config'
import { NotesIntents, type NotesIntent } from '../../../lib/notes/intents'
import { recoverPublicIntent } from '../../../lib/notes/chain/recovery'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { useSigner } from '../../sign/signerContext'

type Props = { client: NotesReadClient; store: NotesStore; partition: NotesPartition; onOpen(id: string): void }
export function PublicOperationStatus(props: Props) {
    const { client, store } = props
    const lease = useMemo(() => ({ client, store, id: newNoteId() }), [client, store])
    return <Receipts key={JSON.stringify([lease.id, props.partition])} {...props} />
}
function Receipts({ client, store, partition, onOpen }: Props) {
    const [session] = useState(createDraftSession), working = useRef(false)
    const [items, setItems] = useState<NotesIntent[]>([]), [limit, setLimit] = useState(20)
    const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [reload, refresh] = useState(0)
    const { version } = useSigner(), { chainId, realm, owner } = partition
    useLayoutEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        const guard = session.capture(); let alive = true
        const load = () => void new NotesIntents(store).list({ chainId, realm, owner }).then(receipts => {
            if (alive && !guard.signal.aborted) setItems(receipts.filter(item => ['prepared', 'submitted', 'unknown'].includes(item.phase)))
        }).catch(() => { if (alive && !guard.signal.aborted) setNotice('Saved operation receipts could not be read. Nothing was retried.') })
        load(); window.addEventListener('focus', load)
        return () => { alive = false; window.removeEventListener('focus', load) }
    }, [store, chainId, realm, owner, session, reload, version])
    async function check(intent: NotesIntent) {
        if (working.current || intent.verification?.kind !== 'public-v1') return
        working.current = true; setBusy(true)
        const guard = session.capture()
        try {
            const result = await recoverPublicIntent(client, new NotesIntents(store), intent, session)
            if (guard.signal.aborted) return
            setNotice(result === 'confirmed' ? 'Publication confirmed. Your draft baseline was kept. Compare it with the published note.' : 'The outcome remains unknown. The receipt and draft were kept; nothing was resent.')
            refresh(value => value + 1)
        } catch { if (!guard.signal.aborted) setNotice('The outcome could not be checked. Nothing was resent.') }
        finally { if (!guard.signal.aborted) { working.current = false; setBusy(false) } }
    }
    if (!items.length && !notice) return null
    return <section className="os-notes-receipts" aria-label="Unresolved note operations"><h3>Operation receipts</h3>
        {items.slice(0, limit).map(intent => <div key={intent.operationId}>
            <p>Outcome unknown · Operation {intent.operationId}</p>
            <button className="os-btn" onClick={() => onOpen(intent.scope.noteId)}>Open note</button>
            {intent.verification?.kind === 'public-v1' ? <button className="os-btn" disabled={busy} onClick={() => void check(intent)}>Check outcome</button>
                : <p>This saved operation is unsupported in this public view. Its receipt was kept; nothing was resent.</p>}
        </div>)}
        {items.length > limit && <button className="os-btn" onClick={() => setLimit(value => value + 20)}>Show more operations</button>}
        {notice && <p role="status">{notice}</p>}
    </section>
}
