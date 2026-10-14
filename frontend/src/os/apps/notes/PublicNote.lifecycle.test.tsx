import { useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import { PublicNote } from './PublicNote'
import { announceNoteChange } from '../../../lib/notes/freshness'
vi.mock('./MarkdownPreview', () => ({ MarkdownPreview: () => <p>Preview</p> }))
const note = { id: 'ab'.repeat(16), owner: 'owner', mode: 4, stateRevision: '1', title: new TextEncoder().encode('Title'), body: new TextEncoder().encode('Body'), deleted: false, actor: 'owner' } as ChainNote
function Composer() { const [body, setBody] = useState(''); return <textarea aria-label="In memory comment" value={body} onChange={event => setBody(event.target.value)} /> }
/** The refresh the note hands its children, as a control: the reader itself has no Refresh button. */
const refresher = (body?: ReactNode) => (_note: ChainNote, refresh: () => void) => <>{body}<button onClick={refresh}>Refresh</button></>
const shown = (revision: string) => `Published · revision ${revision} · by you`
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
describe('published document refresh lifetime', () => {
  it('keeps comment deletion controls available on an encrypted tombstone', async () => {
    const tombstone = { ...note, mode: 1 as const, deleted: true, title: new Uint8Array(), body: new Uint8Array() }
    render(<PublicNote id={note.id} client={{ note: async () => tombstone }} owner="owner">{() => <button>Delete my old comment</button>}</PublicNote>)
    expect(await screen.findByRole('heading', { name: 'Deleted note' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete my old comment' })).toBeVisible()
  })
  it('keeps the same mounted composer through successful refresh and failed revalidation', async () => {
    const next = deferred<ChainNote>(), failed = deferred<ChainNote>()
    const client = { note: vi.fn().mockResolvedValueOnce(note).mockReturnValueOnce(next.promise).mockReturnValueOnce(failed.promise) }
    render(<PublicNote id={note.id} client={client} owner="owner">{refresher(<Composer />)}</PublicNote>)
    const composer = await screen.findByLabelText('In memory comment'); fireEvent.change(composer, { target: { value: 'Unsaved thought' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); expect(screen.getByLabelText('In memory comment')).toBe(composer)
    await act(async () => next.resolve({ ...note, stateRevision: '2' }))
    expect(screen.getByLabelText('In memory comment')).toBe(composer); expect(composer).toHaveValue('Unsaved thought')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await act(async () => failed.reject(new Error('diagnostic')))
    expect(screen.getByLabelText('In memory comment')).toBe(composer); expect(composer).toHaveValue('Unsaved thought'); expect(screen.getByRole('alert')).not.toHaveTextContent('diagnostic')
  })
})

describe('published document freshness', () => {
  const chainId = 'onyx-1'
  it('re-reads after a confirmed change to this note without a manual refresh', async () => {
    const client = { chainId, note: vi.fn().mockResolvedValueOnce(note).mockResolvedValue({ ...note, stateRevision: '2', title: new TextEncoder().encode('Renamed') }) }
    render(<PublicNote id={note.id} client={client} owner="owner" />)
    await screen.findByText(shown('1'))
    act(() => announceNoteChange({ chainId, noteId: note.id, stateRevision: '2' }))
    expect(await screen.findByText(shown('2'))).toBeVisible(); expect(screen.getByRole('heading', { name: 'Renamed' })).toBeVisible()
  })
  it('keeps reading until a lagging node shows the confirmed revision', async () => {
    const client = { chainId, note: vi.fn().mockResolvedValueOnce(note).mockResolvedValueOnce(note).mockResolvedValue({ ...note, stateRevision: '2' }) }
    render(<PublicNote id={note.id} client={client} owner="owner" />)
    await screen.findByText(shown('1'))
    act(() => announceNoteChange({ chainId, noteId: note.id, stateRevision: '2' }))
    expect(await screen.findByText(shown('2'), {}, { timeout: 3000 })).toBeVisible(); expect(client.note).toHaveBeenCalledTimes(3)
  })
  it('shows loading instead of a stale not-found answer while the note is read again', async () => {
    const later = deferred<ChainNote>()
    const client = { chainId, note: vi.fn().mockResolvedValueOnce(null).mockReturnValueOnce(later.promise) }
    render(<PublicNote id={note.id} client={client} owner="owner" />)
    expect(await screen.findByRole('heading', { name: 'Note not found' })).toBeVisible()
    act(() => announceNoteChange({ chainId, noteId: note.id, stateRevision: '1' }))
    expect(screen.queryByRole('heading', { name: 'Note not found' })).toBeNull(); expect(screen.getByRole('status')).toHaveTextContent('Loading note')
    await act(async () => later.resolve(note))
    expect(screen.getByRole('heading', { name: 'Title' })).toBeVisible()
  })
  it('never replaces the shown revision with an older or absent answer from a lagging node', async () => {
    const older = deferred<ChainNote>(), absent = deferred<ChainNote | null>()
    const client = { chainId, note: vi.fn().mockResolvedValueOnce({ ...note, stateRevision: '2' }).mockReturnValueOnce(older.promise).mockReturnValueOnce(absent.promise) }
    render(<PublicNote id={note.id} client={client} owner="owner">{refresher()}</PublicNote>)
    await screen.findByText(shown('2'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await waitFor(() => expect(client.note).toHaveBeenCalledTimes(2))
    await act(async () => older.resolve(note)); expect(screen.getByText(shown('2'))).toBeVisible(); expect(screen.queryByText(shown('1'))).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await waitFor(() => expect(client.note).toHaveBeenCalledTimes(3))
    await act(async () => absent.resolve(null)); expect(screen.getByText(shown('2'))).toBeVisible(); expect(screen.queryByRole('heading', { name: 'Note not found' })).toBeNull()
  })
  it('ignores changes to other notes and networks', async () => {
    const client = { chainId, note: vi.fn(async () => note) }
    render(<PublicNote id={note.id} client={client} owner="owner" />)
    await screen.findByText(shown('1'))
    act(() => { announceNoteChange({ chainId: 'gnoland-1', noteId: note.id }); announceNoteChange({ chainId, noteId: 'cd'.repeat(16) }) })
    await waitFor(() => expect(client.note).toHaveBeenCalledOnce())
  })
})
