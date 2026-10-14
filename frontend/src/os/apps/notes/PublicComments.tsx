import { useEffect, useRef, useState } from 'react'
import { AnchorQuote } from './AnchorQuote'
import { useBlockTimes } from './blockTimes'
import { check } from '../../../lib/notes/chain/schema'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { isRedactedComment, readPublicComments, type CommentsClient, type PublicComment } from '../../../lib/notes/chain/comments'

/** Block times are optional: a client without them shows comments without "… ago". */
type Client = CommentsClient & Partial<Pick<NotesReadClient, 'chainId' | 'blockTimeMs'>>
export interface PublicCommentsProps {
  client: Client; noteId: string; epoch: string; bodyRevision: string; viewer?: string | null
  previewRoot?: HTMLElement | null
  canResolve?: boolean; canHide?: boolean
  /** A change re-reads the first page while the current list stays visible. */
  refreshToken?: number
  /** Comments shown on the first page (deleted ones excluded), and whether more pages follow. */
  onCount?(count: number, more: boolean): void
  /** Existing full controls remain enabled unless a public-only consumer opts out. */
  allowEncryptedActions?: boolean
  onReply?(comment: PublicComment): void; onDelete?(comment: PublicComment): void
  onResolve?(comment: PublicComment, resolved: boolean): void; onHide?(comment: PublicComment, hidden: boolean): void
}
type Page = { key: string; client: Client; items: PublicComment[]; cursor: string; next: string; history: string[]; loading: boolean; error: boolean }
const short = (address: string) => address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address
/** No wallet or local persistence: callbacks only prepare an explicitly chosen action elsewhere. */
export function PublicComments(props: PublicCommentsProps) {
  const { client, noteId, epoch, bodyRevision, viewer, refreshToken = 0 } = props
  const [reload, setReload] = useState(0)
  const key = JSON.stringify([noteId, epoch, bodyRevision, reload])
  const empty = (): Page => ({ key, client, items: [], cursor: '', next: '', history: [], loading: true, error: false })
  const [page, setPage] = useState<Page>(empty)
  const lifetime = useRef<AbortController | null>(null), busy = useRef(false)
  const retry = useRef<{ cursor: string; history: string[] } | null>(null)
  /** The page being read: a refocus or a confirmed change re-reads it instead of jumping back to the first one. */
  const at = useRef<{ key: string; client: Client | null; cursor: string; history: string[] }>({ key: '', client: null, cursor: '', history: [] })
  const counted = useRef(props.onCount)
  useEffect(() => { counted.current = props.onCount }, [props.onCount])
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; busy.current = true; retry.current = null
    const same = at.current.key === key && at.current.client === client
    const cursor = same ? at.current.cursor : '', history = same ? at.current.history : []
    void readPublicComments(client, noteId, epoch, bodyRevision, cursor).then(result => {
      if (controller.signal.aborted) return
      at.current = { key, client, cursor, history }
      setPage({ key, client, items: result.items, cursor, next: result.nextCursor, history, loading: false, error: false })
      if (!cursor) counted.current?.(result.items.filter(item => !item.deleted).length, !!result.nextCursor)
    }).catch(() => {
      if (controller.signal.aborted) return
      retry.current = { cursor, history }
      // A failed refresh keeps the comments already shown.
      setPage(value => same && value.key === key && value.client === client ? { ...value, loading: false, error: true } : { key, client, items: [], cursor, next: '', history, loading: false, error: true })
    }).finally(() => { if (!controller.signal.aborted) busy.current = false })
    return () => controller.abort()
  }, [client, noteId, epoch, bodyRevision, key, refreshToken])
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
        at.current = { key, client, cursor, history }
        if (!cursor) counted.current?.(result.items.filter(item => !item.deleted).length, !!result.nextCursor)
      }
    } catch { if (!controller.signal.aborted) setPage(value => ({ ...value, loading: false, error: true })) }
    finally { if (!controller.signal.aborted) busy.current = false }
  }
  const visible = page.key === key && page.client === client ? page : empty()
  const when = useBlockTimes(client, visible.items.map(comment => comment.createdHeight))
  const copy = (comment: PublicComment) => ({ ...comment })
  return <section className="os-notes-comments" aria-label="Public comments">
    <header><h2>Comments</h2><button className="os-btn os-quiet" disabled={visible.loading} onClick={() => setReload(value => value + 1)}>Refresh</button></header>
    <p className="os-sub">Oldest first · Public: comments stay in chain history unless a moderator removes them.</p>
    <ol>{visible.items.map(comment => { const who = viewer && viewer === comment.author ? 'You' : short(comment.author), ago = when(comment.createdHeight); return <li key={comment.id}>
      <article className="os-notes-comment" aria-label={`Comment by ${who}`}>
        <header><strong title={comment.author}>{who}</strong><span> · {comment.bodyRevision === bodyRevision ? 'on the current text' : 'on an earlier text'}</span>{ago && <span> · {ago}</span>}{comment.epoch !== epoch && <span> · Earlier epoch</span>}{comment.resolved && <span className="os-notes-pill"> Resolved</span>}</header>
        {comment.parent && <p className="os-sub">Reply to {comment.parent}</p>}
        {comment.deleted ? <p>Deleted by the author</p> : isRedactedComment(comment) ? <p>Removed by moderation</p> : comment.hidden ? <p>Hidden by moderation</p> : comment.encrypted ? <p>Encrypted comment</p> : <>
          {comment.anchor && <AnchorQuote quote={comment.anchor} bodyRevision={comment.bodyRevision} currentBodyRevision={bodyRevision} previewRoot={props.previewRoot} />}
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.body}</p>
        </>}
        {viewer && <footer>
          {!comment.deleted && !comment.hidden && !comment.encrypted && props.onReply && <button className="os-btn os-quiet" onClick={() => props.onReply?.(copy(comment))}>Reply</button>}
          {(!comment.encrypted || props.allowEncryptedActions !== false) && !comment.deleted && viewer === comment.author && props.onDelete && <button className="os-btn os-quiet" onClick={() => props.onDelete?.(copy(comment))}>Delete comment</button>}
          {(!comment.encrypted || props.allowEncryptedActions !== false) && props.canResolve && props.onResolve && <button className="os-btn os-quiet" onClick={() => props.onResolve?.(copy(comment), !comment.resolved)}>{comment.resolved ? 'Reopen thread' : 'Resolve thread'}</button>}
          {(!comment.encrypted || props.allowEncryptedActions !== false) && props.canHide && props.onHide && !isRedactedComment(comment) && <button className="os-btn os-quiet" onClick={() => props.onHide?.(copy(comment), !comment.hidden)}>{comment.hidden ? 'Unhide comment' : 'Hide comment'}</button>}
        </footer>}
      </article>
    </li> })}</ol>
    {visible.loading && <p role="status">Loading comments…</p>}
    {!visible.loading && !visible.error && !visible.items.length && <p>No comments on this page.</p>}
    {visible.error && <div role="alert"><p>Comments could not be loaded. Please try again.</p><button className="os-btn" onClick={() => retry.current ? void navigate(retry.current.cursor, retry.current.history) : setReload(value => value + 1)}>Retry comments</button></div>}
    {!!visible.history.length && <button className="os-btn" disabled={visible.loading} onClick={() => void navigate(visible.history.at(-1)!, visible.history.slice(0, -1))}>Previous comments</button>}
    {visible.next && <button className="os-btn" disabled={visible.loading} onClick={() => void navigate(visible.next, [...visible.history, visible.cursor].slice(-50))}>Next comments</button>}
  </section>
}
