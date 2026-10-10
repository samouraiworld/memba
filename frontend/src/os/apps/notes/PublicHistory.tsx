import { useCallback, useMemo, useState } from 'react'
import { newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { HistoryAction, PublicHistoryEntry } from '../../../lib/notes/chain/history'
import { check } from '../../../lib/notes/chain/schema'
import { PublicHistoryCommentView, PublicHistoryVersions, useHistoryRead, type HistoryRestore } from './PublicHistoryContent'
import './notes-history.css'

export type { ArchivedPublicDraft } from './PublicHistoryContent'
export type PublicHistoryProps = { noteId: string; client: NotesReadClient; onRestore?: HistoryRestore }
const actions: Record<HistoryAction, string> = {
    create: 'Public note created', publish: 'Note made public', 'content-commit': 'Content updated', 'comment-mode': 'Comment permissions changed',
    'public-writes': 'Community editing changed', 'writer-add': 'Writer added', 'writer-remove': 'Writer removed',
    'owner-propose': 'Ownership proposed', 'owner-cancel': 'Ownership proposal cancelled', 'owner-accept': 'Ownership accepted',
    'policy-set': 'Policy set', 'gov-writers': 'Governance writers changed', 'owner-listing': 'Public listing changed',
    'listing-moderation': 'Listing moderated', 'note-delete': 'Note deleted', 'legacy-epoch-reveal': 'Earlier epoch revealed',
    'comment-add': 'Comment added', 'comment-delete': 'Comment deleted', 'comment-visibility': 'Comment visibility changed',
    'comment-resolution': 'Comment resolution changed', cleanup: 'Current storage cleaned up',
}
/** Guest-readable and read-only; restoration delegates copied content, never a signature. */
export function PublicHistory(props: PublicHistoryProps) {
    const { client, noteId } = props
    const lease = useMemo(() => ({ client, noteId, id: newNoteId() }), [client, noteId])
    return <HistorySession key={lease.id} {...props} />
}
function HistorySession({ client, noteId, onRestore }: PublicHistoryProps) {
    const [cursor, setCursor] = useState({ after: '0', through: '0', generation: 0 })
    const [selected, setSelected] = useState<string | null>(null)
    const [versions, setVersions] = useState<string[]>([])
    const read = useCallback(async () => {
        client.assertCurrent()
        const info = await client.publicHistoryInfo(noteId); client.assertCurrent()
        if (info === null) return null
        const page = await client.publicHistory(noteId, cursor.after, cursor.through, 20)
        client.assertCurrent(); check(page !== null)
        return { info, page }
    }, [client, noteId, cursor])
    const { state } = useHistoryRead(read), data = state.data
    function navigate(after: string) {
        if (!data || state.loading) return
        setSelected(null); setVersions([])
        setCursor(value => ({ ...value, after, through: data.page.throughSeq }))
    }
    function chooseVersion(revision: string, compare = false) {
        setVersions(old => compare && old.length ? [old[0], revision] : [revision])
    }
    return <section className="os-notes-history" aria-label="Public history">
        <header><h2>Public history</h2><button className="os-btn os-quiet" disabled={state.loading} onClick={() => {
            setSelected(null); setVersions([]); setCursor(value => ({ after: '0', through: '0', generation: value.generation + 1 }))
        }}>Refresh history</button></header>
        <p>Public versions are retained permanently, including after deletion. Coverage starts at public publication; earlier private content, access maintenance and global administration are excluded.</p>
        {state.loading && <p role="status">Loading public history…</p>}
        {state.error && <p role="alert">Public history could not be verified. Refresh to try again.</p>}
        {!state.loading && !state.error && data === null && <p>No public history is available for this note.</p>}
        {data && <>
            <p>From state revision {data.info.startStateRevision} · Page snapshot through event {data.page.throughSeq} · Oldest first</p>
            {(data.info.deleted || data.info.moderatorHidden) && <p>This note is currently hidden or deleted. Archived content requires an explicit reveal.</p>}
            <ol>{data.page.items.map(item => <li key={item.seq}>
                <button className="os-btn os-quiet" aria-pressed={selected === item.seq} onClick={() => setSelected(item.seq)}>Event {item.seq}: {actions[item.action]}</button>
                <p>Actor {item.actor} · Height {item.height} · State revision {item.stateRevision}</p>
                {item.executor && <p>Executed by {item.executor} · Governance proposal {item.proposalId}</p>}
            </li>)}</ol>
            {cursor.after !== '0' && <button className="os-btn" disabled={state.loading} onClick={() => navigate((BigInt(cursor.after) > 20n ? BigInt(cursor.after) - 20n : 0n).toString())}>Previous history</button>}
            {data.page.nextCursor && <button className="os-btn" disabled={state.loading} onClick={() => navigate(data.page.nextCursor!)}>Next history</button>}
        </>}
        {selected && <HistoryDetail key={selected} client={client} noteId={noteId} seq={selected} chooseVersion={chooseVersion} canCompare={versions.length > 0} />}
        {!!versions.length && <PublicHistoryVersions key={`${selected}:${versions.join(':')}`} client={client} noteId={noteId} revisions={versions} onRestore={onRestore} />}
    </section>
}
function HistoryDetail({ client, noteId, seq, chooseVersion, canCompare }: {
    client: NotesReadClient; noteId: string; seq: string; chooseVersion(revision: string, compare?: boolean): void; canCompare: boolean
}) {
    const read = useCallback(async () => {
        client.assertCurrent()
        const entry = await client.publicHistoryEntry(noteId, seq)
        client.assertCurrent(); check(entry !== null)
        return entry
    }, [client, noteId, seq])
    const { state } = useHistoryRead(read), entry = state.data
    return <section aria-label={`History event ${seq}`}>
        {state.loading && <p role="status">Loading event…</p>}
        {state.error && <p role="alert">This history event could not be verified.</p>}
        {entry && <>
            <h3>{actions[entry.action]} · Event {entry.seq}</h3>
            <p>Actor {entry.actor} · Height {entry.height}</p>
            {entry.operationId && <p>Operation {entry.operationId}</p>}
            {entry.executor && <p>Executor {entry.executor} · Proposal {entry.proposalId} · {entry.governanceAction}</p>}
            <HistoryDetailFields entry={entry} />
            {entry.detail.kind === 'note' && <>
                <button className="os-btn" onClick={() => chooseVersion(entry.detail.kind === 'note' ? entry.detail.snapshotRevision : '')}>Read version {entry.stateRevision}</button>
                {canCompare && <button className="os-btn os-quiet" onClick={() => chooseVersion(entry.stateRevision, true)}>Compare with version {entry.stateRevision}</button>}
            </>}
            {entry.detail.kind === 'comment' && <PublicHistoryCommentView client={client} noteId={noteId} commentId={entry.detail.commentId} />}
        </>}
    </section>
}
function HistoryDetailFields({ entry }: { entry: PublicHistoryEntry }) {
    const d = entry.detail
    if (d.kind === 'cleanup') return <p>Removed {d.total} current records: {d.commentIndex} comment index, {d.comments} comments, {d.cooldowns} cooldowns, {d.epochs} epochs, {d.requests} requests. Public archives remain.</p>
    if (d.kind === 'comment') return <p>Comment revision {d.commentRevision} · {d.deleted ? 'Deleted' : 'Retained'} · {d.hidden ? 'Hidden' : 'Visible'} · {d.resolved ? 'Resolved' : 'Open'}</p>
    return <>
        <p>State revision {d.snapshotRevision}{d.previousStateRevision && `, following ${d.previousStateRevision}`}</p>
        {d.fieldMask && <p>Changed: {d.fieldMask === 1 ? 'title' : d.fieldMask === 2 ? 'body' : 'title and body'}. A title-only change may be Commit or Rename.</p>}
        {d.policyOp !== null && <p>Policy: {['read', 'write', 'comment'][d.policyOp]} · {d.policyKey || 'cleared'}</p>}
        {d.targetEpoch && <p>Earlier epoch {d.targetEpoch}; private key material is excluded from this archive.</p>}
    </>
}
