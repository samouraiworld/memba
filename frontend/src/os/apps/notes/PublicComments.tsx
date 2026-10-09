import { useEffect, useRef, useState } from 'react'
import { AnchorQuote } from './AnchorQuote'
import { check } from '../../../lib/notes/chain/schema'
import { readPublicComments, type CommentsClient, type PublicComment } from '../../../lib/notes/chain/comments'

export interface PublicCommentsProps {
  client: CommentsClient; noteId: string; epoch: string; bodyRevision: string; viewer?: string | null
  previewRoot?: HTMLElement | null
  canResolve?: boolean; canHide?: boolean
  onReply?(comment: PublicComment): void; onDelete?(comment: PublicComment): void
  onResolve?(comment: PublicComment, resolved: boolean): void; onHide?(comment: PublicComment, hidden: boolean): void
}
type Page = { key: string; client: CommentsClient; items: PublicComment[]; cursor: string; next: string; history: string[]; loading: boolean; error: boolean }
/** No wallet or local persistence: callbacks only prepare an explicitly chosen action elsewhere. */
export function PublicComments(props: PublicCommentsProps) {
  const { client, noteId, epoch, bodyRevision, viewer } = props
  const [reload, setReload] = useState(0)
  const key = JSON.stringify([noteId, epoch, bodyRevision, reload])
  const empty = (): Page => ({ key, client, items: [], cursor: '', next: '', history: [], loading: true, error: false })
  const [page, setPage] = useState<Page>(empty)
  const lifetime = useRef<AbortController | null>(null), busy = useRef(false)
  const retry = useRef<{ cursor: string; history: string[] } | null>(null)
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; busy.current = true; retry.current = null
    void readPublicComments(client, noteId, epoch, bodyRevision).then(result => {
      if (!controller.signal.aborted) setPage({ key, client, items: result.items, cursor: '', next: result.nextCursor, history: [], loading: false, error: false })
    }).catch(() => { if (!controller.signal.aborted) setPage({ key, client, items: [], cursor: '', next: '', history: [], loading: false, error: true }) })
      .finally(() => { if (!controller.signal.aborted) busy.current = false })
    return () => controller.abort()
  }, [client, noteId, epoch, bodyRevision, key])
  async function navigate(cursor: string, history: string[]) {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || busy.current || page.key !== key || page.client !== client) return
    busy.current = true; retry.current = { cursor, history }
    setPage(value => ({ ...value, loading: true, error: false }))
    try {
      const result = await readPublicComments(client, noteId, epoch, bodyRevision, cursor)
      if (!controller.signal.aborted) {
        if (cursor && cursor === page.next && page.items.length && result.items.length) {
          check(BigInt(result.items[0].createdHeight) >= BigInt(page.items.at(-1)!.createdHeight))
          const previous = new Set(page.items.map(item => item.id)); check(result.items.every(item => !previous.has(item.id)))
        }
        setPage({ key, client, items: result.items, cursor, next: result.nextCursor, history, loading: false, error: false }); retry.current = null
      }
    } catch { if (!controller.signal.aborted) setPage(value => ({ ...value, loading: false, error: true })) }
    finally { if (!controller.signal.aborted) busy.current = false }
  }
  const visible = page.key === key && page.client === client ? page : empty()
  const copy = (comment: PublicComment) => ({ ...comment })
  return <section className="os-notes-comments" aria-label="Public comments">
    <header><h2>Comments</h2><button className="os-btn os-quiet" disabled={visible.loading} onClick={() => setReload(value => value + 1)}>Refresh comments</button></header>
    <p className="os-sub">Oldest first · Public comments remain in chain history.</p>
    <ol>{visible.items.map(comment => <li key={comment.id}>
      <article aria-label={`Comment by ${comment.author}`}>
        <header><span>{comment.author}</span> · <span>Body revision {comment.bodyRevision}</span>{comment.epoch !== epoch && <span> · Earlier epoch</span>}{comment.resolved && <strong> · Resolved</strong>}</header>
        {comment.parent && <p className="os-sub">Reply to {comment.parent}</p>}
        {comment.deleted ? <p>Deleted by the author</p> : comment.hidden ? <p>Hidden by moderation</p> : comment.encrypted ? <p>Encrypted comment</p> : <>
          {comment.anchor && <AnchorQuote quote={comment.anchor} bodyRevision={comment.bodyRevision} currentBodyRevision={bodyRevision} previewRoot={props.previewRoot} />}
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.body}</p>
        </>}
        {viewer && <footer>
          {!comment.deleted && !comment.hidden && !comment.encrypted && props.onReply && <button className="os-btn os-quiet" onClick={() => props.onReply?.(copy(comment))}>Reply</button>}
          {!comment.deleted && viewer === comment.author && props.onDelete && <button className="os-btn os-quiet" onClick={() => props.onDelete?.(copy(comment))}>Delete comment</button>}
          {props.canResolve && props.onResolve && <button className="os-btn os-quiet" onClick={() => props.onResolve?.(copy(comment), !comment.resolved)}>{comment.resolved ? 'Reopen thread' : 'Resolve thread'}</button>}
          {props.canHide && props.onHide && <button className="os-btn os-quiet" onClick={() => props.onHide?.(copy(comment), !comment.hidden)}>{comment.hidden ? 'Unhide comment' : 'Hide comment'}</button>}
        </footer>}
      </article>
    </li>)}</ol>
    {visible.loading && <p role="status">Loading comments…</p>}
    {!visible.loading && !visible.error && !visible.items.length && <p>No comments on this page.</p>}
    {visible.error && <div role="alert"><p>Comments could not be loaded. Please try again.</p><button className="os-btn" onClick={() => retry.current ? void navigate(retry.current.cursor, retry.current.history) : setReload(value => value + 1)}>Retry comments</button></div>}
    {!!visible.history.length && <button className="os-btn" disabled={visible.loading} onClick={() => void navigate(visible.history.at(-1)!, visible.history.slice(0, -1))}>Previous comments</button>}
    {visible.next && <button className="os-btn" disabled={visible.loading} onClick={() => void navigate(visible.next, [...visible.history, visible.cursor].slice(-50))}>Next comments</button>}
  </section>
}
