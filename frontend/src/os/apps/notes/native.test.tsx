import { fireEvent, render, screen } from '@testing-library/react'
import { useNoteFreshness } from '../../../lib/notes/freshness'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeViewProps } from '../../native/types'
import { PublicNotesView } from './native'
vi.mock('../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../lib/notes/config')>(), NOTES_ENABLED: true }))
vi.mock('./publicNative', () => ({ PublicNotesApp: ({ onOpenNote, onShowList }: { onOpenNote(id: string): void; onShowList(): void }) => <><button onClick={() => onOpenNote('ab'.repeat(16))}>Open valid</button><button onClick={() => onOpenNote('../invalid')}>Open invalid</button><button onClick={onShowList}>Show list</button></> }))
it('routes a valid public note through the native push action without accepting arbitrary sections', () => {
    const push = vi.fn(), open = vi.fn()
    render(<PublicNotesView {...{ push, open, session: {}, section: null, fallback: null } as unknown as NativeViewProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open invalid' })); expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open valid' }))
    expect(push).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'app:notes', app: 'notes', target: { kind: 'app', app: 'notes', section: 'ab'.repeat(16) } }))
    expect(open).not.toHaveBeenCalled()
})
afterEach(() => { vi.useRealTimers() })
it('asks open notes to re-check the chain when a Notes window comes back to the front', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000)
    const seen = vi.fn(), id = 'ab'.repeat(16)
    function Listener() { useNoteFreshness('onyx-1', id, seen); return null }
    const props = { push: vi.fn(), open: vi.fn(), session: { network: { chainId: 'onyx-1' } }, section: id, fallback: null, active: false } as unknown as NativeViewProps
    const view = render(<><Listener /><PublicNotesView {...props} /></>)
    vi.setSystemTime(60_000); view.rerender(<><Listener /><PublicNotesView {...props} active={false} /></>); expect(seen).not.toHaveBeenCalled()
    view.rerender(<><Listener /><PublicNotesView {...props} active /></>); expect(seen).toHaveBeenCalledExactlyOnceWith({})
})
it('returns to the list by clearing the note from the same Notes window', () => {
    const push = vi.fn()
    render(<PublicNotesView {...{ push, open: vi.fn(), session: {}, section: 'ab'.repeat(16), fallback: null } as unknown as NativeViewProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show list' }))
    expect(push).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'app:notes', target: { kind: 'app', app: 'notes', section: null } }))
})
