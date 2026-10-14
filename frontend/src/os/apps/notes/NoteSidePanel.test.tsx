import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesStore } from '../../../lib/notes/drafts'
import { NotesPaneContext, type NotesPane } from './notesPane'
import { NoteSidePanel } from './NoteSidePanel'

const seen = vi.hoisted(() => ({ count: undefined as undefined | ((n: number, more: boolean) => void), restore: undefined as unknown }))
vi.mock('./PublicHistory', () => ({ PublicHistory: (props: { onRestore?: unknown; viewer?: string | null }) => { seen.restore = props.onRestore; return <p>History for {props.viewer ?? 'guest'}</p> } }))
vi.mock('./PublicCommentPanel', async () => {
    const { AnchorQuote } = await vi.importActual<typeof import('./AnchorQuote')>('./AnchorQuote')
    return { PublicCommentPanel: (props: { onCount(n: number, more: boolean): void; previewRoot: HTMLElement | null }) => { seen.count = props.onCount
        return <><textarea aria-label="Comment" />{props.previewRoot && <AnchorQuote quote="nori" bodyRevision="1" currentBodyRevision="1" previewRoot={props.previewRoot} />}</> } }
})
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
        expect(screen.getByRole('button', { name: 'Back to the note' })).toHaveFocus()
        fireEvent.click(screen.getByRole('button', { name: 'Back to the note' }))
        expect(panel).not.toHaveAttribute('data-sheet'); expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus()
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))
        fireEvent.keyDown(screen.getByLabelText('Comment'), { key: 'Escape' })
        expect(panel).not.toHaveAttribute('data-sheet'); expect(screen.getByRole('tab', { name: 'Comments' })).toHaveFocus()
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
    it('opens the sheet at its top and, on Back, returns the note to where it was scrolled', () => {
        let top = 300
        const scroller = document.createElement('div'); scroller.style.overflowY = 'auto'; document.body.append(scroller)
        Object.defineProperties(scroller, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 }, scrollTop: { get: () => top, set: (value: number) => { top = value } } })
        scroller.getBoundingClientRect = () => ({ top: 40 }) as DOMRect
        render(<NoteSidePanel {...props} />, { container: scroller.appendChild(document.createElement('div')) })
        const panel = screen.getByRole('complementary', { name: 'History and comments' })
        panel.style.setProperty('--os-notes-sheet', '1'); panel.getBoundingClientRect = () => ({ top: 940 }) as DOMRect
        fireEvent.click(screen.getByRole('tab', { name: 'History' }))
        expect(panel).toHaveAttribute('data-sheet', 'open'); expect(top).toBe(1200)
        fireEvent.click(screen.getByRole('button', { name: 'Back to the note' }))
        expect(panel).not.toHaveAttribute('data-sheet'); expect(top).toBe(300)
        scroller.remove()
    })
    it('"Show in note" closes the sheet and selects the quote; a quote that is gone keeps the sheet open with the reason', async () => {
        const root = document.createElement('article'); root.dataset.rendered = 'html'; root.innerHTML = '<p>Four nori sheets</p>'; document.body.append(root)
        render(<NoteSidePanel {...props} previewRoot={root} />)
        const panel = screen.getByRole('complementary', { name: 'History and comments' }); panel.style.setProperty('--os-notes-sheet', '1')
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Show in note' }))
        expect(panel).not.toHaveAttribute('data-sheet'); expect(window.getSelection()?.toString()).toBe('nori')
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }))
        expect(panel).toHaveAttribute('data-sheet', 'open')
        const show = await screen.findByRole('button', { name: 'Show in note' })
        root.innerHTML = '<p>Four sheets</p>'; fireEvent.click(show)
        expect(panel).toHaveAttribute('data-sheet', 'open')
        await waitFor(() => expect(within(panel).getByText(/Quote not found in the current text/)).toBeVisible())
        window.getSelection()?.removeAllRanges(); root.remove()
    })
})
