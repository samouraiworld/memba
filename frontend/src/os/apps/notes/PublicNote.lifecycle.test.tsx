import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import { PublicNote } from './PublicNote'
vi.mock('./MarkdownPreview', () => ({ MarkdownPreview: () => <p>Preview</p> }))
const note = { id: 'ab'.repeat(16), owner: 'owner', mode: 4, stateRevision: '1', title: new TextEncoder().encode('Title'), body: new TextEncoder().encode('Body'), deleted: false } as ChainNote
function Composer() { const [body, setBody] = useState(''); return <textarea aria-label="In memory comment" value={body} onChange={event => setBody(event.target.value)} /> }
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
    render(<PublicNote id={note.id} client={client} owner="owner">{() => <Composer />}</PublicNote>)
    const composer = await screen.findByLabelText('In memory comment'); fireEvent.change(composer, { target: { value: 'Unsaved thought' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); expect(screen.getByLabelText('In memory comment')).toBe(composer)
    await act(async () => next.resolve({ ...note, stateRevision: '2' }))
    expect(screen.getByLabelText('In memory comment')).toBe(composer); expect(composer).toHaveValue('Unsaved thought')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await act(async () => failed.reject(new Error('diagnostic')))
    expect(screen.getByLabelText('In memory comment')).toBe(composer); expect(composer).toHaveValue('Unsaved thought'); expect(screen.getByRole('alert')).not.toHaveTextContent('diagnostic')
  })
})
