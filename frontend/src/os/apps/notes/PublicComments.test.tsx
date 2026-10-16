import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { bech32Encode } from '../../../lib/dao/realmAddress'
import { encode64 } from '../../../lib/notes/chain/schema'
import { PublicComments } from './PublicComments'

const owner = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = '01'.repeat(16)
/** Opens a card's ⋯ menu. */
const menu = (article: HTMLElement) => fireEvent.click(within(article).getByRole('button', { name: /^More actions for the comment by / }))
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
  it('a private note: author and time only until opened; opened text, "earlier version" and undecryptable states; a new decrypt function drops the text', async () => {
    const enc = (n: number, epoch = '2') => ({ ...row(n), encrypted: true, epoch, anchor_blob: '', body_blob: encode64(new Uint8Array(59)) })
    const client = { commentsRaw: vi.fn(async () => page([enc(1), enc(2, '1'), enc(3)])) }
    const view = render(<PublicComments client={client} noteId={noteId} epoch="2" bodyRevision="1" encryptedNote />)
    expect(await screen.findAllByText('Encrypted comment')).toHaveLength(3); expect(screen.getByRole('region', { name: 'Encrypted comments' })).toBeVisible()
    expect(screen.queryByText(/on the current text/)).toBeNull(); expect(screen.queryByText(/Earlier epoch/)).toBeNull()
    const ids = [row(1).id, row(2).id, row(3).id]
    const decrypt = vi.fn(async () => new Map([[ids[0], { status: 'open' as const, body: 'Opened text', quote: 'Passage' }], [ids[1], { status: 'no-key' as const }], [ids[2], { status: 'unavailable' as const }]]))
    view.rerender(<PublicComments client={client} noteId={noteId} epoch="2" bodyRevision="1" encryptedNote decrypt={decrypt} />)
    expect(await screen.findByText('Opened text')).toBeVisible(); expect(screen.getByText('Passage')).toBeVisible()
    expect(screen.getByText('Comment from an earlier version you can’t open')).toBeVisible(); expect(screen.getByText('This encrypted comment could not be decrypted.')).toBeVisible()
    view.rerender(<PublicComments client={client} noteId={noteId} epoch="2" bodyRevision="1" encryptedNote />)
    await waitFor(() => expect(screen.queryByText('Opened text')).toBeNull()); expect(screen.getAllByText('Encrypted comment')).toHaveLength(3)
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
  it('keeps the page being read when a refocus or confirmed change refreshes the list', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(i + 1)), cursor = '00000000000000000005:' + row(5).id
    const client = { commentsRaw: vi.fn(async (_id: string, at: string) => at ? page([row(6)]) : page(rows, cursor)) }
    const view = render(<PublicComments client={client} noteId={noteId} epoch="0" bodyRevision="1" refreshToken={0} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Next comments' }))
    expect(await screen.findByText('Comment 6')).toBeVisible()
    view.rerender(<PublicComments client={client} noteId={noteId} epoch="0" bodyRevision="1" refreshToken={1} />)
    await vi.waitFor(() => expect(client.commentsRaw).toHaveBeenCalledTimes(3))
    expect(client.commentsRaw.mock.calls[2][1]).toBe(cursor)
    expect(screen.getByText('Comment 6')).toBeVisible(); expect(screen.getByRole('button', { name: 'Previous comments' })).toBeVisible()
  })
  it('reports how many comments the first page shows, and whether more follow', async () => {
    const onCount = vi.fn(), cursor = '00000000000000000005:' + row(5).id
    const rows = [...Array.from({ length: 4 }, (_, i) => row(i + 1)), { ...row(5), deleted: true, body_blob: '', anchor_blob: '' }]
    render(<PublicComments client={{ commentsRaw: vi.fn(async () => page(rows, cursor)) }} noteId={noteId} epoch="0" bodyRevision="1" onCount={onCount} />)
    await vi.waitFor(() => expect(onCount).toHaveBeenCalledWith(4, true))
  })
  it('says who wrote each comment, on which revision, and quotes the passage it is about', async () => {
    render(<PublicComments client={{ commentsRaw: vi.fn(async () => page([row()])) }} noteId={noteId} epoch="0" bodyRevision="2" viewer={owner} />)
    const article = await screen.findByRole('article', { name: 'Comment by You' })
    // F20: the card never shows the body counter as "revision"; this comment is on body revision 1, the note's is 2.
    expect(within(article).getByText(/^· on an earlier text$/)).toBeVisible(); expect(within(article).queryByText(/revision/)).toBeNull()
    expect(within(article).getByText('Passage')).toBeVisible()
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
    // Reply stays on the card; the other actions are in its ⋯ menu, which closes after each choice.
    expect(within(article).queryByRole('button', { name: 'Delete comment' })).toBeNull()
    for (const name of ['Delete comment', 'Resolve thread', 'Hide comment']) { menu(article); fireEvent.click(within(article).getByRole('menuitem', { name })) }
    expect(within(article).queryByRole('menu')).toBeNull()
    expect(onDelete).toHaveBeenCalledOnce(); expect(onResolve.mock.calls[0][1]).toBe(true); expect(onHide.mock.calls[0][1]).toBe(true)
    onReply.mock.calls[0][0].body = 'Mutated'
    expect(screen.getByText('Comment 1')).toBeVisible()
  })
  it('preserves encrypted controls by default but lets a public-only caller hide them', async () => {
    const encrypted = { ...row(), encrypted: true, anchor_blob: '', body_blob: encode64(new Uint8Array(59)) }
    const props = { client: { commentsRaw: vi.fn(async () => page([encrypted])) }, noteId, epoch: '0', bodyRevision: '1', viewer: owner,
      canHide: true, canResolve: true, onDelete: vi.fn(), onHide: vi.fn(), onResolve: vi.fn() }
    const view = render(<PublicComments {...props} />)
    menu(await screen.findByRole('article'))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Resolve thread', 'Hide comment', 'Delete comment'])
    view.rerender(<PublicComments {...props} allowEncryptedActions={false} />)
    expect(screen.getByText('Encrypted comment')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^More actions for the comment/ })).toBeNull()
    for (const name of ['Delete comment', 'Resolve thread', 'Hide comment']) expect(screen.queryByRole('menuitem', { name })).toBeNull()
    expect(props.onDelete).not.toHaveBeenCalled(); expect(props.onHide).not.toHaveBeenCalled(); expect(props.onResolve).not.toHaveBeenCalled()
  })

  it('shows a moderator-removed comment as removed and never offers to unhide it', async () => {
    const client = { commentsRaw: vi.fn(async () => page([{ ...row(), hidden: true, body_blob: '', anchor_blob: '' }, { ...row(2), hidden: true }])) }
    render(<PublicComments client={client} noteId={noteId} epoch="0" bodyRevision="1" viewer={owner} canHide onHide={vi.fn()} />)
    expect(await screen.findByText('Removed by moderation')).toBeVisible()
    expect(screen.getByText('Hidden by moderation')).toBeVisible()
    const [removed, hidden] = screen.getAllByRole('article')
    expect(within(removed).queryByRole('button', { name: /^More actions/ })).toBeNull()
    menu(hidden); expect(within(hidden).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Unhide comment'])
  })

  it('opens the card menu from the keyboard, moves with the arrows and returns the focus on Escape', async () => {
    const client = { commentsRaw: vi.fn(async () => page([row()])) }
    render(<PublicComments client={client} noteId={noteId} epoch="0" bodyRevision="1" viewer={owner} canHide canResolve onDelete={vi.fn()} onHide={vi.fn()} onResolve={vi.fn()} />)
    const article = await screen.findByRole('article'), button = within(article).getByRole('button', { name: 'More actions for the comment by You' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu'); expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(article).getByRole('menu', { name: 'More actions for the comment by You' })).toBeVisible()
    expect(within(article).getByRole('menuitem', { name: 'Resolve thread' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); expect(within(article).getByRole('menuitem', { name: 'Hide comment' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' }); expect(within(article).getByRole('menuitem', { name: 'Delete comment' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); expect(within(article).getByRole('menuitem', { name: 'Resolve thread' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(within(article).queryByRole('menu')).toBeNull(); expect(button).toHaveFocus()
    fireEvent.click(button); fireEvent.click(within(article).getByRole('menuitem', { name: 'Hide comment' }))
    expect(within(article).queryByRole('menu')).toBeNull(); expect(button).toHaveFocus()
  })
  it('names each card menu with the author and the comment\'s time, so two cards by one author differ', async () => {
    const client = { chainId: 'times-test', commentsRaw: vi.fn(async () => page([row(1), row(2)])), blockTimeMs: vi.fn(async (height: string) => Date.now() - Number(height) * 3_600_000) }
    render(<PublicComments client={client} noteId={noteId} epoch="0" bodyRevision="1" viewer={owner} onDelete={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^More actions for the comment by You, / }).map(button => button.getAttribute('aria-label'))).toEqual(['More actions for the comment by You, 1 hour ago', 'More actions for the comment by You, 2 hours ago']))
  })
})
