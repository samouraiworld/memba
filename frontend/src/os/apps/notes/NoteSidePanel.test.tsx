import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesStore } from '../../../lib/notes/drafts'
import { NotesPaneContext, type NotesPane } from './notesPane'
import { NoteSidePanel } from './NoteSidePanel'

const seen = vi.hoisted(() => ({ count: undefined as undefined | ((n: number, more: boolean) => void), restore: undefined as unknown }))
vi.mock('./PublicHistory', () => ({ PublicHistory: (props: { onRestore?: unknown; viewer?: string | null }) => { seen.restore = props.onRestore; return <p>History for {props.viewer ?? 'guest'}</p> } }))
vi.mock('./PublicCommentPanel', () => ({ PublicCommentPanel: (props: { onCount(n: number, more: boolean): void }) => { seen.count = props.onCount; return <textarea aria-label="Comment" /> } }))
const note = { id: 'ab'.repeat(16), owner: 'g1owner', mode: 4, deleted: false } as ChainNote
const props = { note, client: {} as NotesReadClient, store: {} as NotesStore, owner: 'g1owner', previewRoot: null }

describe('History and comments panel', () => {
    it('shows History first, switches tabs without unmounting, and counts comments in the tab', () => {
        render(<NoteSidePanel {...props} />)
        screen.getByRole('complementary', { name: 'History and comments' }).style.setProperty('--os-notes-sheet', '1')
        const panel = screen.getByRole('complementary', { name: 'History and comments' })
        expect(within(panel).getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByText('History for g1owner')).toBeVisible()
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'kept' } })
        act(() => seen.count!(5, true))
        fireEvent.click(screen.getByRole('tab', { name: 'Comments · 5+' }))
        expect(screen.getByLabelText('Comment')).toBeVisible(); expect(screen.getByText('History for g1owner')).not.toBeVisible()
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Comments · 5+' }), { key: 'ArrowLeft' })
        expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus(); expect(screen.getByLabelText('Comment')).toHaveValue('kept')
    })
    it('opens as a sheet with Back at phone width only', () => {
        const view = render(<NoteSidePanel {...props} />)
        const panel = screen.getByRole('complementary', { name: 'History and comments' })
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))
        expect(panel).not.toHaveAttribute('data-sheet')
        panel.style.setProperty('--os-notes-sheet', '1')
        fireEvent.click(screen.getByRole('tab', { name: 'History' }))
        expect(panel).toHaveAttribute('data-sheet', 'open')
        fireEvent.click(screen.getByRole('button', { name: 'Back to the note' }))
        expect(panel).not.toHaveAttribute('data-sheet')
        view.rerender(<NoteSidePanel {...props} hidden />)
        expect(panel).not.toBeVisible()
    })
    it('goes to the pane side slot when the workspace provides one', () => {
        const side = document.createElement('div'); document.body.append(side)
        const pane = { hold() {}, saved() {}, deleted() {}, focusTitle: false, titleFocused() {}, side } satisfies NotesPane
        render(<NotesPaneContext.Provider value={pane}><main><NoteSidePanel {...props} /></main></NotesPaneContext.Provider>)
        expect(side.querySelector('[aria-label="History and comments"]')).not.toBeNull()
        expect(screen.getByRole('main')).toBeEmptyDOMElement()
        side.remove()
    })
    it('passes the restore path to History, and has no comment tab for an encrypted note', () => {
        const onRestore = vi.fn()
        render(<NoteSidePanel {...props} note={{ ...note, mode: 1 }} onRestore={onRestore} />)
        expect(seen.restore).toBe(onRestore)
        expect(screen.queryByRole('tab', { name: /Comments/ })).toBeNull()
    })
})
