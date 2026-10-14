import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_NETWORK_KEY } from '../../../lib/config'
import { DeskShortcutsContext } from '../../shell/deskShortcuts'
import { NoteBanner, NoteHeader, NoteSheet } from './NoteHeader'
import { NotesPaneContext, type NotesPane } from './notesPane'

const id = 'ab'.repeat(16)
const writeText = vi.fn(async () => {})
beforeEach(() => { vi.clearAllMocks(); Object.assign(navigator, { clipboard: { writeText } }) })
afterEach(() => vi.restoreAllMocks())
function pane(patch: Partial<NotesPane> = {}): NotesPane { return { hold: vi.fn(), saved: vi.fn(), deleted: vi.fn(), focusTitle: false, titleFocused: vi.fn(), ...patch } }

describe('note header', () => {
    it('holds Share, one primary action and a menu with the note actions', async () => {
        const exported = vi.fn(), desk = { isPinned: vi.fn(() => false), pin: vi.fn(), unpin: vi.fn() }
        render(<DeskShortcutsContext.Provider value={desk}><NoteHeader noteId={id} published status="Published · revision 6 · by you" primary={<button>Edit</button>}
            share={<button>Share</button>} menu={[{ label: 'Export', hint: 'Sushi.md', run: exported }, { label: 'Delete note…', danger: true, run: vi.fn() }]} /></DeskShortcutsContext.Provider>)
        expect(screen.getByRole('status')).toHaveTextContent('Published · revision 6 · by you')
        expect(screen.getAllByRole('button').map(button => button.textContent || button.getAttribute('aria-label'))).toEqual(['Share', 'Edit', 'More actions'])
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
        const menu = screen.getByRole('menu', { name: 'More actions' })
        expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Copy link', 'ExportSushi.md', 'Add to Desktop', 'Delete note…'])
        expect(within(menu).getByRole('menuitem', { name: 'Copy link' })).toHaveFocus()
        fireEvent.keyDown(menu, { key: 'ArrowDown' }); expect(within(menu).getByRole('menuitem', { name: /Export/ })).toHaveFocus()
        fireEvent.click(within(menu).getByRole('menuitem', { name: /Export/ }))
        expect(exported).toHaveBeenCalledOnce(); expect(screen.queryByRole('menu')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'More actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Desktop' }))
        expect(desk.pin).toHaveBeenCalledWith({ ty: 'note', ref: id }); expect(screen.queryByRole('menu')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'More actions' })); fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
        expect(screen.queryByRole('menu')).toBeNull(); expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
    })
    it('copies the network-qualified note link from the menu', async () => {
        render(<NoteHeader noteId={id} published status="Published" />)
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
        await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' })))
        expect(writeText).toHaveBeenCalledWith(`${location.origin}/${ACTIVE_NETWORK_KEY}/os/notes/${id}`); expect(screen.getByRole('status')).toHaveTextContent('Link copied.')
    })
    it('offers no link for a draft that only exists on this device', () => {
        render(<NoteHeader noteId={id} status="Draft saved on this device" />)
        expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
        expect(screen.queryByRole('menuitem', { name: 'Copy link' })).toBeNull()
    })
})

describe('note banner and sheet', () => {
    it('announces warnings as alerts and progress as status', () => {
        const view = render(<NoteBanner notice={{ tone: 'warn', title: 'Cancelled in Adena.', text: 'Nothing was sent.', actions: <button>Publish again</button> }} />)
        expect(screen.getByRole('alert')).toHaveTextContent('Cancelled in Adena. Nothing was sent.'); expect(screen.getByRole('button', { name: 'Publish again' })).toBeVisible()
        view.rerender(<NoteBanner notice={{ tone: 'pending', text: 'Checking.' }} />); expect(screen.getByRole('status')).toHaveTextContent('Checking.')
        view.rerender(<NoteBanner notice={null} />); expect(screen.queryByRole('status')).toBeNull()
    })
    it('shows a sheet only while its note is on screen, in the window overlay', () => {
        const overlay = document.createElement('div'); document.body.append(overlay)
        const close = vi.fn()
        const view = render(<NotesPaneContext.Provider value={pane({ shown: true, overlay })}><NoteSheet label="Publish" onClose={close}><button>Keep editing</button></NoteSheet></NotesPaneContext.Provider>)
        const dialog = within(overlay).getByRole('dialog', { name: 'Publish' }); expect(dialog).toHaveFocus()
        fireEvent.keyDown(dialog, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce()
        view.rerender(<NotesPaneContext.Provider value={pane({ shown: false, overlay })}><NoteSheet label="Publish"><button>Keep editing</button></NoteSheet></NotesPaneContext.Provider>)
        expect(screen.queryByRole('dialog')).toBeNull(); overlay.remove()
    })
})
