import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DeskShortcutsContext, type DeskShortcuts } from '../../shell/deskShortcuts'
import { NoteDeskButton } from './NoteDeskButton'

const id = 'ab'.repeat(16)
function desk(pinned: boolean): DeskShortcuts { return { isPinned: vi.fn(() => pinned), pin: vi.fn(), unpin: vi.fn() } }

it('adds the open note to the Desktop through the shell desk', () => {
    const value = desk(false)
    render(<DeskShortcutsContext.Provider value={value}><NoteDeskButton noteId={id} /></DeskShortcutsContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Add to Desktop' }))
    expect(value.pin).toHaveBeenCalledExactlyOnceWith({ ty: 'note', ref: id }); expect(value.unpin).not.toHaveBeenCalled()
})

it('offers Remove from Desktop when the note is already there, and never touches the note', () => {
    const value = desk(true)
    render(<DeskShortcutsContext.Provider value={value}><NoteDeskButton noteId={id} /></DeskShortcutsContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Desktop' }))
    expect(value.unpin).toHaveBeenCalledExactlyOnceWith({ ty: 'note', ref: id }); expect(value.pin).not.toHaveBeenCalled()
})

it('renders nothing outside the shell desk or for an invalid note address', () => {
    const { container, rerender } = render(<NoteDeskButton noteId={id} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<DeskShortcutsContext.Provider value={desk(false)}><NoteDeskButton noteId="../x" /></DeskShortcutsContext.Provider>)
    expect(container).toBeEmptyDOMElement()
})
