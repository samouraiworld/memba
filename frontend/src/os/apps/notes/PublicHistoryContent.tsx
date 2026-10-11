import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { PublicHistoryInfo } from '../../../lib/notes/chain/history'
import type { PublicHistoryComment, PublicHistoryVersion } from '../../../lib/notes/chain/historyContent'
import { readPublicHistoryBody } from '../../../lib/notes/chain/historyBody'
import { check, publicText } from '../../../lib/notes/chain/schema'

export type ArchivedPublicDraft = { noteId: string; sourceStateRevision: string; title: string; body: string }
export type HistoryRestore = (draft: ArchivedPublicDraft) => void | Promise<void>
type ReadState<T> = { read?: (reveal: boolean) => Promise<T>; data?: T; loading: boolean; error: boolean }

/** Invalidates queued reads and callbacks on refresh, selection change and unmount. */
// Shared lifecycle hook stays beside its two history-only consumers.
// eslint-disable-next-line react-refresh/only-export-components
export function useHistoryRead<T>(read: (reveal: boolean) => Promise<T>) {
    const [state, setState] = useState<ReadState<T>>({ loading: true, error: false })
    const sequence = useRef(0)
    const refresh = useCallback(async (reveal = false) => {
        const token = ++sequence.current
        setState({ read, loading: true, error: false })
        try {
            const data = await read(reveal)
            if (sequence.current === token) setState({ read, data, loading: false, error: false })
        } catch {
            if (sequence.current === token) setState({ read, loading: false, error: true })
        }
    }, [read])
    useLayoutEffect(() => () => { sequence.current++ }, [refresh])
    // Start the external read after commit; read identity hides stale data synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void refresh() }, [refresh])
    const capture = () => {
        const token = sequence.current
        return () => sequence.current === token
    }
    const visible: ReadState<T> = state.read === read ? state : { loading: true, error: false }
    return { state: visible, refresh, capture, fail: () => setState({ read, loading: false, error: true }) }
}
function restricted(info: PublicHistoryInfo) { return info.deleted || info.moderatorHidden }
async function currentInfo(client: NotesReadClient, noteId: string) {
    client.assertCurrent()
    const info = await client.publicHistoryInfo(noteId)
    client.assertCurrent(); check(info !== null)
    return info
}
function sameHead(before: PublicHistoryInfo, after: PublicHistoryInfo) {
    check(before.headSeq === after.headSeq && before.deleted === after.deleted && before.moderatorHidden === after.moderatorHidden)
}
type LoadedVersion = { version: PublicHistoryVersion; draft: ArchivedPublicDraft | null }
async function versionContent(client: NotesReadClient, noteId: string, revision: string): Promise<LoadedVersion> {
    const version = await client.publicHistoryVersion(noteId, revision)
    client.assertCurrent(); check(version !== null)
    if (version.deleted) return { version, draft: null }
    check(version.title !== null && version.bodyRevision !== null)
    const body = await readPublicHistoryBody(client, noteId, version.bodyRevision)
    client.assertCurrent()
    check(body !== null && body.id === version.id && body.bodyRevision === version.bodyRevision && body.sha256 === version.bodySha256 && new TextEncoder().encode(body.text).length === version.bodyBytes)
    return { version, draft: { noteId, sourceStateRevision: revision, title: publicText(version.title, true), body: body.text } }
}

export function PublicHistoryVersions({ client, noteId, revisions, onRestore }: {
    client: NotesReadClient; noteId: string; revisions: readonly string[]; onRestore?: HistoryRestore
}) {
    const first = revisions[0], second = revisions[1]
    const read = useCallback(async (reveal: boolean) => {
        check(!!first && revisions.length <= 2)
        const info = await currentInfo(client, noteId)
        if (restricted(info) && !reveal) return { info, versions: [] as LoadedVersion[], gated: true }
        const versions = [await versionContent(client, noteId, first)]
        if (second) versions.push(await versionContent(client, noteId, second))
        sameHead(info, await currentInfo(client, noteId))
        return { info, versions, gated: false }
    }, [client, noteId, first, second, revisions.length])
    const { state, refresh, capture, fail } = useHistoryRead(read)
    const restoring = useRef(false)
    const [notice, setNotice] = useState('')
    async function restore(draft: ArchivedPublicDraft) {
        if (!onRestore || !state.data || state.data.gated || state.data.info.deleted || restoring.current) return
        const alive = capture(); restoring.current = true; setNotice('')
        try {
            const info = await currentInfo(client, noteId)
            if (!alive()) return
            sameHead(state.data.info, info); check(!info.deleted)
            await onRestore({ ...draft })
            if (alive()) setNotice('Archived content passed to the draft editor. Nothing was signed.')
        } catch { if (alive()) fail() }
        finally { restoring.current = false }
    }
    const data = state.data
    return <section aria-label="Archived versions">
        <h3>{second ? 'Compare archived versions' : 'Archived version'}</h3>
        <p>Plain text comparison, at most two versions of 128 KiB each. Restoring prepares a new draft; archives never change.</p>
        {state.loading && <p role="status">Loading archived versions…</p>}
        {state.error && <p role="alert">The archive or its current visibility could not be verified. No content is shown.</p>}
        {data?.gated && <div><p>This note is currently hidden or deleted. Its public archive is retained.</p>
            <button className="os-btn" onClick={() => void refresh(true)}>Show archived content</button></div>}
        {data && !data.gated && <>
            {restricted(data.info) && <p>Explicit historical view of a currently hidden or deleted note.</p>}
            {data.versions.length === 2 && <p>{data.versions[0].draft?.title === data.versions[1].draft?.title && data.versions[0].draft?.body === data.versions[1].draft?.body ? 'The content is identical.' : 'The content differs. Compare the versions below.'}</p>}
            <div className="os-notes-history-comparison">{data.versions.map(({ version, draft }, index) => <article key={`${index}:${version.stateRevision}`} aria-label={`Version ${version.stateRevision}`}>
                <h4>State revision {version.stateRevision}</h4>
                <p>Owner {version.owner} · Body revision {version.bodyRevision ?? 'none'} · {version.bodyBytes} bytes</p>
                <details><summary>Version permissions and visibility</summary><dl>
                    <dt>Owner generation</dt><dd>{version.ownerGeneration}</dd>
                    <dt>Pending owner</dt><dd>{version.pendingOwner ?? 'None'}</dd>
                    <dt>Writers</dt><dd>{version.writers.join(', ') || 'None'}</dd>
                    <dt>Community editing</dt><dd>{version.allowPublicWrites ? 'Enabled' : 'Disabled'}</dd>
                    <dt>Governance writers</dt><dd>{version.govWriters ? 'Enabled' : 'Disabled'}</dd>
                    <dt>Comments</dt><dd>{version.mode === 4 ? 'Open to everyone' : 'Restricted'}</dd>
                    <dt>Read policy</dt><dd>{version.policies.read || 'None'}</dd>
                    <dt>Write policy</dt><dd>{version.policies.write || 'None'}</dd>
                    <dt>Comment policy</dt><dd>{version.policies.comment || 'None'}</dd>
                    <dt>Owner listing</dt><dd>{version.ownerListed ? 'Listed' : 'Unlisted'}</dd>
                    <dt>Moderation</dt><dd>{version.moderatorHidden ? 'Hidden' : 'Visible'}</dd>
                </dl></details>
                {draft ? <><h5>{draft.title}</h5><pre tabIndex={0} aria-label={`Body of version ${version.stateRevision}`}>{draft.body}</pre>
                    <button className="os-btn" disabled={!onRestore || data.info.deleted} onClick={() => void restore(draft)}>Use version {version.stateRevision} as a new draft</button></>
                    : <p>This revision records deletion. Earlier versions remain available.</p>}
            </article>)}</div>
            {!onRestore && <p>Creating a draft is unavailable in this view.</p>}
            {data.info.deleted && <p>A deleted note cannot receive a restored version.</p>}
        </>}
        {notice && <p role="status">{notice}</p>}
        <button className="os-btn os-quiet" disabled={state.loading} onClick={() => { setNotice(''); void refresh() }}>Refresh archived versions</button>
    </section>
}

export function PublicHistoryCommentView({ client, noteId, commentId }: { client: NotesReadClient; noteId: string; commentId: string }) {
    const read = useCallback(async (reveal: boolean) => {
        const info = await currentInfo(client, noteId)
        const comment = await client.publicHistoryComment(noteId, commentId)
        client.assertCurrent(); check(comment !== null)
        sameHead(info, await currentInfo(client, noteId))
        const latest = await client.publicHistoryComment(noteId, commentId)
        client.assertCurrent(); check(latest !== null && samePresentation(comment, latest))
        sameHead(info, await currentInfo(client, noteId))
        const hidden = restricted(info) || comment.presentation.hidden || comment.presentation.deleted
        return { comment: hidden && !reveal ? null : comment, gated: hidden && !reveal, hidden }
    }, [client, noteId, commentId])
    const { state, refresh } = useHistoryRead(read)
    const data = state.data, comment = data?.comment
    return <section aria-label="Archived comment">
        <h3>Archived comment</h3>
        {state.loading && <p role="status">Checking current comment visibility…</p>}
        {state.error && <p role="alert">Current visibility is unavailable. Archived comment content is not shown.</p>}
        {data?.gated && <div><p>This comment or note is currently hidden or deleted.</p>
            <button className="os-btn" onClick={() => void refresh(true)}>Show archived comment</button></div>}
        {comment && <>
            {data?.hidden && <p>Explicit historical view of hidden or deleted content.</p>}
            <p>Author {comment.content.author} · Body revision {comment.content.reference.bodyRevision}</p>
            {comment.content.reference.anchorHistoryBodyRevision === null && <p>The referenced body version is unavailable in the public archive.</p>}
            {comment.content.reference.parent && <p>Reply to {comment.content.reference.parent}{!comment.content.reference.parentHistoryAvailable && ' · Parent unavailable in the public archive'}</p>}
            {!!comment.content.anchor.length && <blockquote>{publicText(comment.content.anchor)}</blockquote>}
            <pre tabIndex={0} aria-label="Original public comment">{publicText(comment.content.body)}</pre>
            <p>Current presentation: {comment.presentation.resolved ? 'resolved' : 'open'}; history event {comment.presentation.latestSeq}.</p>
        </>}
        <button className="os-btn os-quiet" disabled={state.loading} onClick={() => void refresh()}>Refresh archived comment</button>
    </section>
}
function samePresentation(a: PublicHistoryComment, b: PublicHistoryComment) {
    return a.presentation.latestSeq === b.presentation.latestSeq && a.presentation.hidden === b.presentation.hidden
        && a.presentation.deleted === b.presentation.deleted && a.presentation.resolved === b.presentation.resolved
}
