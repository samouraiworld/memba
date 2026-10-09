import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { bech32Encode } from '../../../lib/dao/realmAddress'
import { encode64 } from '../../../lib/notes/chain/schema'
import { PublicComments } from './PublicComments'

const owner = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = '01'.repeat(16)
const b64 = (value: string) => encode64(new TextEncoder().encode(value))
const row = (n = 1) => ({ id: n.toString(16).padStart(32, '0'), parent: '0'.repeat(32), author: owner, encrypted: false, body_revision: '1', epoch: '0', revision: '1', anchor_blob: b64('Passage'), body_blob: b64(`Comment ${n}`), created_height: String(n), op_id: '03'.repeat(16), actor: owner, height: String(n), deleted: false, hidden: false, resolved: false })
const page = (items = [row()], next_cursor = '') => ({ items, next_cursor })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

describe('public comments', () => {
  it('reads as a guest, treats body and anchor as text, masks hidden/deleted/encrypted content and renders thread metadata', async () => {
    const rows = [
      { ...row(), body_blob: b64('<img src=x onerror=alert(1)>'), anchor_blob: b64('<script>secret()</script>') },
      { ...row(2), hidden: true, body_blob: b64('Moderated payload') },
      { ...row(3), deleted: true, body_blob: '', anchor_blob: '' },
      { ...row(4), encrypted: true, anchor_blob: '', body_blob: encode64(new Uint8Array(59)) },
      { ...row(5), parent: row().id, resolved: true },
    ]
    const callback = vi.fn(), client = { commentsRaw: vi.fn(async () => page(rows)) }
    const view = render(<PublicComments client={client} noteId={noteId} epoch="1" bodyRevision="2" onReply={callback} onDelete={callback} canHide canResolve onHide={callback} onResolve={callback} />)
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(view.container.querySelector('img,script')).toBeNull()
    expect(screen.queryByText('Moderated payload')).toBeNull()
    for (const text of ['Hidden by moderation', 'Deleted by the author', 'Encrypted comment']) expect(screen.getByText(text)).toBeVisible()
    expect(screen.getByText(`Reply to ${row().id}`)).toBeVisible(); expect(screen.getByText(/Resolved/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull(); expect(callback).not.toHaveBeenCalled()
    expect(client.commentsRaw).toHaveBeenCalledExactlyOnceWith(noteId, '', 5)
  })
  it('paginates chronologically with bounded visible rows and retries the failed page without losing the current one', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(i + 1)), cursor = '00000000000000000005:' + row(5).id
    const client = { commentsRaw: vi.fn().mockResolvedValueOnce(page(rows, cursor)).mockRejectedValueOnce(new Error(noteId))
      .mockResolvedValueOnce(page([row(6)])).mockResolvedValueOnce(page(rows, cursor)) }
    render(<PublicComments client={client} noteId={noteId} epoch="0" bodyRevision="1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Next comments' }))
    expect(await screen.findByRole('alert')).not.toHaveTextContent(noteId); expect(screen.getByText('Comment 1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry comments' }))
    expect(await screen.findByText('Comment 6')).toBeVisible(); expect(screen.queryByText('Comment 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Previous comments' }))
    expect(await screen.findByText('Comment 1')).toBeVisible(); expect(screen.queryByText('Comment 6')).toBeNull()
    expect(client.commentsRaw.mock.calls.map(args => args[1])).toEqual(['', cursor, cursor, ''])
  })
  it('ignores stale responses after note/network/version changes and unmount', async () => {
    const pending = deferred<ReturnType<typeof page>>(), client = { commentsRaw: vi.fn(() => pending.promise) }
    const next = { commentsRaw: vi.fn(async () => page([])) }
    const view = render(<PublicComments client={client} noteId={noteId} epoch="0" bodyRevision="1" />)
    view.rerender(<PublicComments client={next} noteId={'22'.repeat(16)} epoch="1" bodyRevision="2" />)
    expect(await screen.findByText('No comments on this page.')).toBeVisible()
    await act(async () => { pending.resolve(page()) })
    expect(screen.queryByText('Comment 1')).toBeNull()
    view.unmount()
  })
  it('only exposes explicitly supplied, eligible action callbacks and passes defensive comment copies', async () => {
    const client = { commentsRaw: vi.fn(async () => page([row()])) }, onReply = vi.fn(), onDelete = vi.fn(), onHide = vi.fn(), onResolve = vi.fn()
    render(<PublicComments client={client} noteId={noteId} epoch="0" bodyRevision="1" viewer={owner} canHide canResolve onReply={onReply} onDelete={onDelete} onHide={onHide} onResolve={onResolve} />)
    const article = await screen.findByRole('article')
    fireEvent.click(within(article).getByRole('button', { name: 'Reply' }))
    fireEvent.click(within(article).getByRole('button', { name: 'Delete comment' }))
    fireEvent.click(within(article).getByRole('button', { name: 'Resolve thread' }))
    fireEvent.click(within(article).getByRole('button', { name: 'Hide comment' }))
    expect(onDelete).toHaveBeenCalledOnce(); expect(onResolve.mock.calls[0][1]).toBe(true); expect(onHide.mock.calls[0][1]).toBe(true)
    onReply.mock.calls[0][0].body = 'Mutated'
    expect(screen.getByText('Comment 1')).toBeVisible()
  })
  it('preserves encrypted controls by default but lets a public-only caller hide them', async () => {
    const encrypted = { ...row(), encrypted: true, anchor_blob: '', body_blob: encode64(new Uint8Array(59)) }
    const props = { client: { commentsRaw: vi.fn(async () => page([encrypted])) }, noteId, epoch: '0', bodyRevision: '1', viewer: owner,
      canHide: true, canResolve: true, onDelete: vi.fn(), onHide: vi.fn(), onResolve: vi.fn() }
    const view = render(<PublicComments {...props} />)
    expect(await screen.findByRole('button', { name: 'Delete comment' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Resolve thread' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Hide comment' })).toBeVisible()
    view.rerender(<PublicComments {...props} allowEncryptedActions={false} />)
    expect(screen.getByText('Encrypted comment')).toBeVisible()
    for (const name of ['Delete comment', 'Resolve thread', 'Hide comment']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(props.onDelete).not.toHaveBeenCalled(); expect(props.onHide).not.toHaveBeenCalled(); expect(props.onResolve).not.toHaveBeenCalled()
  })

})
