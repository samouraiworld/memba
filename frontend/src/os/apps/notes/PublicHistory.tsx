import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { newNoteId } from '../../../lib/notes/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { HistoryAction, PublicHistoryPage } from '../../../lib/notes/chain/history'
import type { PublicHistoryVersion } from '../../../lib/notes/chain/historyContent'
import { readRestorableVersion } from '../../../lib/notes/chain/historyDraft'
import { check, publicText } from '../../../lib/notes/chain/schema'
import { readFresh, useNoteRefresh } from '../../../lib/notes/freshness'
import { PublicHistoryCommentView, PublicHistoryVersions, useHistoryRead, type HistoryRestore } from './PublicHistoryContent'
import { useBlockTimes } from './blockTimes'
import './notes-history.css'

export type { ArchivedPublicDraft } from './PublicHistoryContent'
export type PublicHistoryProps = { noteId: string; client: NotesReadClient; onRestore?: HistoryRestore; viewer?: string | null }
type Item = PublicHistoryPage['items'][number]
const PAGE = 20
const actions: Record<HistoryAction, string> = {
    create: 'created', publish: 'made public', 'content-commit': 'edited', 'comment-mode': 'comment permissions changed',
    'public-writes': 'community editing changed', 'writer-add': 'writer added', 'writer-remove': 'writer removed',
    'owner-propose': 'ownership offered', 'owner-cancel': 'ownership offer cancelled', 'owner-accept': 'ownership accepted',
    'policy-set': 'access policy set', 'gov-writers': 'governance writers changed', 'owner-listing': 'listing changed',
    'listing-moderation': 'listing moderated', 'note-delete': 'deleted', 'legacy-epoch-reveal': 'earlier epoch revealed',
    'comment-add': 'Comment added', 'comment-delete': 'Comment deleted', 'comment-visibility': 'Comment hidden or shown',
    'comment-resolution': 'Comment thread resolved or reopened', cleanup: 'Old records cleaned up',
    'content-redact': 'redacted by moderation', 'comment-redact': 'Comment removed by moderation',
}
const COMMENT_EVENTS: readonly HistoryAction[] = ['comment-add', 'comment-delete', 'comment-visibility', 'comment-resolution', 'comment-redact', 'cleanup']
/** Events read once more to say what changed: an edit's field mask (and new title), a setting's new value. */
const DESCRIBED: readonly HistoryAction[] = ['content-commit', 'public-writes', 'comment-mode']
/** What an event changed. Title and body revisions are separate counters, so only the entry's field mask says which field an edit touched. */
type Detail = { fieldMask?: 1 | 2 | 3 | null; version?: PublicHistoryVersion }
/** Events that leave content worth reading again or restoring. */
const CONTENT: readonly HistoryAction[] = ['create', 'publish', 'content-commit']
const short = (address: string) => address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address

/** What happened, in plain words: "Revision 5 · body edited". */
function headline(item: Item, detail: Detail | undefined): string {
    if (COMMENT_EVENTS.includes(item.action)) return actions[item.action]
    const revision = `Revision ${item.stateRevision}`, mask = detail?.fieldMask, version = detail?.version
    if (item.action === 'content-commit' && mask) return `${revision} · ${mask === 3 ? 'title and body edited' : mask === 1 ? 'renamed' : 'body edited'}`
    if (item.action === 'public-writes' && version) return `${revision} · ${version.allowPublicWrites ? 'editing opened to everyone' : 'editing closed'}`
    if (item.action === 'comment-mode' && version) return `${revision} · ${version.mode === 4 ? 'comments opened to everyone' : 'comments limited to editors'}`
    return `${revision} · ${actions[item.action]}`
}
function renamedTo(item: Item, detail: Detail | undefined): string {
    if (item.action !== 'content-commit' || !detail?.fieldMask || !(detail.fieldMask & 1) || !detail.version?.title) return ''
    try { return publicText(detail.version.title, true) } catch { return '' }
}

/** Guest-readable timeline, newest first; restoring copies archived content into a draft, never signs. */
export function PublicHistory(props: PublicHistoryProps) {
    const { client, noteId } = props
    const lease = useMemo(() => ({ client, noteId, id: newNoteId() }), [client, noteId])
    return <HistorySession key={lease.id} {...props} />
}
function HistorySession({ client, noteId, onRestore, viewer }: PublicHistoryProps) {
    // `after` null: the newest page. Older pages keep the head they started from.
    const [cursor, setCursor] = useState<{ after: string | null; through: string; generation: number }>({ after: null, through: '0', generation: 0 })
    const [viewing, setViewing] = useState<string | null>(null)
    const { tick, minimum } = useNoteRefresh(client.chainId, noteId)
    const read = useCallback(async () => {
        client.assertCurrent()
        const info = await readFresh(() => client.publicHistoryInfo(noteId), value => value?.latestStateRevision ?? null, minimum(), () => true); client.assertCurrent()
        if (!info) return null
        const through = cursor.through === '0' ? info.headSeq : cursor.through
        const after = cursor.after ?? (BigInt(through) > BigInt(PAGE) ? (BigInt(through) - BigInt(PAGE)).toString() : '0')
        const page = await client.publicHistory(noteId, after, through, PAGE)
        client.assertCurrent(); check(page !== null)
        return { info, page, after }
    }, [client, noteId, cursor, minimum])
    const { state } = useHistoryRead(read), data = state.data
    const reload = useCallback(() => { setViewing(null); setCursor(value => ({ after: null, through: '0', generation: value.generation + 1 })) }, [])
    // Confirmed changes and refocus re-check the history head; a new event reloads from the head.
    const head = useRef<string | null>(null)
    useEffect(() => { head.current = data ? data.info.headSeq : null }, [data])
    useEffect(() => {
        if (tick === 0) return
        let alive = true
        // Only a newer head reloads: an announced revision makes a lagging answer wait, and an older head is ignored.
        void readFresh(() => client.publicHistoryInfo(noteId), value => value?.latestStateRevision ?? null, minimum(), () => alive)
            .then(info => { if (alive && info && (head.current === null || BigInt(info.headSeq) > BigInt(head.current))) reload() })
            .catch(() => { /* The next check or Refresh retries. */ })
        return () => { alive = false }
    }, [tick, client, noteId, minimum, reload])
    const items = useMemo(() => data ? [...data.page.items].reverse() : [], [data])
    const details = useDetails(client, noteId, items)
    const when = useBlockTimes(client, items.map(item => item.height))
    const [restoring, setRestoring] = useState<string | null>(null), [notice, setNotice] = useState('')
    const mounted = useRef(false)
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    async function restoreAsDraft(revision: string) {
        if (!onRestore || restoring) return
        setRestoring(revision); setNotice('')
        try {
            const draft = await readRestorableVersion(client, noteId, revision)
            if (!mounted.current) return
            if (!draft) { setNotice(`Revision ${revision} has no content to restore: it was removed by moderation.`); return }
            await onRestore({ ...draft })
            if (mounted.current) setNotice(`Revision ${revision} was copied into a draft. Nothing was signed.`)
        } catch { if (mounted.current) setNotice('That version could not be checked against the current history. Nothing was changed; try again.') }
        finally { if (mounted.current) setRestoring(null) }
    }
    function page(after: string) {
        if (!data || state.loading) return
        setViewing(null); setCursor(value => ({ ...value, after, through: data.page.throughSeq }))
    }
    const older = data && data.after !== '0' ? (BigInt(data.after) > BigInt(PAGE) ? (BigInt(data.after) - BigInt(PAGE)).toString() : '0') : null
    // Newer pages end at the head they started from, so the newest page is always a full one.
    const newestAfter = data ? (BigInt(data.page.throughSeq) > BigInt(PAGE) ? BigInt(data.page.throughSeq) - BigInt(PAGE) : 0n) : 0n
    const newer = data && BigInt(data.after) < newestAfter ? (BigInt(data.after) + BigInt(PAGE) < newestAfter ? BigInt(data.after) + BigInt(PAGE) : newestAfter).toString() : null
    return <section className="os-notes-history" aria-label="Public history">
        <header><h2>History</h2><button className="os-btn os-quiet" disabled={state.loading} onClick={reload}>Refresh</button></header>
        {state.loading && !data && <p role="status">Loading history…</p>}
        {state.error && <p role="alert">History could not be verified. Refresh to try again.</p>}
        {!state.loading && !state.error && data === null && <p>No public history is available for this note.</p>}
        {data && <>
            {(data.info.deleted || data.info.moderatorHidden) && <p>This note is currently hidden or deleted. Archived content requires an explicit reveal.</p>}
            <ol className="os-notes-timeline">{items.map(item => {
                const detail = details[item.seq], version = detail?.version, who = viewer && viewer === item.actor ? 'You' : short(item.actor)
                const renamed = renamedTo(item, detail), ago = when(item.height), comment = COMMENT_EVENTS.includes(item.action)
                const restorable = CONTENT.includes(item.action) && !(version && (version.titleRedacted || version.bodyRedacted || version.deleted))
                return <li key={item.seq} data-kind={comment ? 'comment' : 'revision'}>
                    <span className="os-notes-timeline-dot" aria-hidden="true" />
                    <div>
                        <strong>{headline(item, detail)}</strong>
                        <p>{[who, renamed && `“${renamed}”`, item.executor && 'via governance', ago].filter(Boolean).join(' · ')}</p>
                        {restorable && <div className="os-notes-timeline-actions">
                            <button className="os-btn os-quiet" aria-pressed={viewing === item.seq} aria-label={`View revision ${item.stateRevision}`}
                                onClick={() => setViewing(value => value === item.seq ? null : item.seq)}>View</button>
                            {onRestore && <button className="os-btn os-quiet" disabled={!!restoring || data.info.deleted} aria-label={`Use revision ${item.stateRevision} as a draft`}
                                onClick={() => void restoreAsDraft(item.stateRevision)}>{restoring === item.stateRevision ? 'Copying…' : 'Use as draft'}</button>}
                        </div>}
                        {item.commentId && <div className="os-notes-timeline-actions">
                            <button className="os-btn os-quiet" aria-pressed={viewing === item.seq} aria-label={`View archived comment of event ${item.seq}`}
                                onClick={() => setViewing(value => value === item.seq ? null : item.seq)}>View</button>
                        </div>}
                        {viewing === item.seq && (item.commentId ? <PublicHistoryCommentView client={client} noteId={noteId} commentId={item.commentId} />
                            : <PublicHistoryVersions key={item.stateRevision} client={client} noteId={noteId} revisions={[item.stateRevision]} onRestore={onRestore} />)}
                    </div>
                </li>
            })}</ol>
            {notice && <p role="status">{notice}</p>}
            {(newer || older) && <div className="os-notes-timeline-pages">
                {newer && <button className="os-btn os-quiet" disabled={state.loading} onClick={() => page(newer)}>Newer</button>}
                {older && <button className="os-btn os-quiet" disabled={state.loading} onClick={() => page(older)}>Older</button>}
            </div>}
            <p className="os-notes-history-note">From revision {data.info.startStateRevision}, when the note became public. Earlier versions stay readable here unless a moderator removes them.</p>
        </>}
    </section>
}
/** What each described event changed, read a few at a time; absent until read (or when unreadable). */
function useDetails(client: NotesReadClient, noteId: string, items: readonly Item[]) {
    const wanted = items.filter(item => DESCRIBED.includes(item.action)).map(item => `${item.seq}:${item.action}:${item.stateRevision}`).join(',')
    const [read, setRead] = useState<{ client: NotesReadClient; noteId: string; at: Readonly<Record<string, Detail>> }>({ client, noteId, at: {} })
    useEffect(() => {
        if (!wanted) return
        let alive = true
        const one = async (seq: string, action: string, revision: string): Promise<Detail | null> => {
            if (action !== 'content-commit') { const version = await client.publicHistoryVersion(noteId, revision); return version ? { version } : null }
            const entry = await client.publicHistoryEntry(noteId, seq)
            if (!entry || entry.detail.kind !== 'note') return null
            const fieldMask = entry.detail.fieldMask
            // A rename names the new title, which only the version recorded at that revision holds.
            const version = fieldMask && fieldMask & 1 ? await client.publicHistoryVersion(noteId, revision) ?? undefined : undefined
            return { fieldMask, version }
        }
        void Promise.resolve().then(async () => {
            const events = wanted.split(',').map(value => value.split(':')), found: Record<string, Detail> = {}
            for (let i = 0; i < events.length && alive; i += 4) {
                await Promise.all(events.slice(i, i + 4).map(async ([seq, action, revision]) => {
                    try { const detail = await one(seq, action, revision); if (detail) found[seq] = detail } catch { /* described generically */ }
                }))
                if (alive) setRead(value => ({ client, noteId, at: { ...(value.client === client && value.noteId === noteId ? value.at : {}), ...found } }))
            }
        })
        return () => { alive = false }
    }, [client, noteId, wanted])
    return read.client === client && read.noteId === noteId ? read.at : {}
}
