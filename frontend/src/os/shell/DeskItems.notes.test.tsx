import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ContextMenu, DeskIcon, DeskItems } from './DeskItems'
import type { DeskItem } from './desk'

const note: DeskItem = { ty: 'note', ref: 'ab'.repeat(16), c: 0, r: 0 }

it('draws a note shortcut as a document with a Notes badge, labelled with its title', () => {
    const { container } = render(<DeskItems items={[note]} noteLabels={{ [note.ref]: 'Sushi' }} deskWidth={1000} onOpen={vi.fn()} onMove={vi.fn()} onMenu={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Sushi' })
    expect(button.querySelector('.os-badge2-note')).not.toBeNull()
    expect(button.querySelector('[data-private]')).toBeNull()
    expect(container.querySelector('.os-badge2-note svg')).not.toBeNull()
})

it('shows a lock badge on a private note shortcut', () => {
    render(<DeskIcon item={note} privateNotes={new Set([note.ref])} />)
    expect(screen.getByText('Note')).toBeTruthy()
    expect(document.querySelector('.os-badge2-note[data-private]')).not.toBeNull()
})

it('opens a note shortcut on click and its menu on right-click', () => {
    const onOpen = vi.fn(), onMenu = vi.fn()
    render(<DeskItems items={[note]} deskWidth={1000} onOpen={onOpen} onMove={vi.fn()} onMenu={onMenu} />)
    const button = screen.getByRole('button', { name: 'Note' })
    fireEvent.click(button); expect(onOpen).toHaveBeenCalledWith(0)
    fireEvent.contextMenu(button); expect(onMenu).toHaveBeenCalledWith(expect.anything(), 0)
})

it('renders a menu hint as text, not as a menu item', () => {
    const run = vi.fn()
    render(<ContextMenu x={0} y={0} entries={[{ label: 'Remove from Desktop', run }, { hint: 'The note itself is not deleted.' }]} onClose={vi.fn()} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    expect(screen.getByText('The note itself is not deleted.')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Remove from Desktop' })).toHaveAccessibleDescription('The note itself is not deleted.')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Desktop' })); expect(run).toHaveBeenCalledOnce()
})
