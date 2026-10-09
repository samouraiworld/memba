import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { NativeViewProps } from '../../native/types'
import { PublicNotesView } from './native'
vi.mock('../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../lib/notes/config')>(), NOTES_ENABLED: true }))
vi.mock('./publicNative', () => ({ PublicNotesApp: ({ onOpenNote }: { onOpenNote(id: string): void }) => <><button onClick={() => onOpenNote('ab'.repeat(16))}>Open valid</button><button onClick={() => onOpenNote('../invalid')}>Open invalid</button></> }))
it('routes a valid public note through the native push action without accepting arbitrary sections', () => {
    const push = vi.fn(), open = vi.fn()
    render(<PublicNotesView {...{ push, open, session: {}, section: null, fallback: null } as unknown as NativeViewProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open invalid' })); expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open valid' }))
    expect(push).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: `notes:${'ab'.repeat(16)}`, app: 'notes', target: { kind: 'app', app: 'notes', section: 'ab'.repeat(16) } }))
    expect(open).not.toHaveBeenCalled()
})
