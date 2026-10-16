import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesStore } from '../../../lib/notes/drafts'
import { PublicCommentPanel } from './PublicCommentPanel'
import { PublicHistory } from './PublicHistory'
import { REVEAL_QUOTE } from './AnchorQuote'
import type { HistoryRestore } from './PublicHistoryContent'
import { useNotesPane } from './notesPane'
import './notes-history.css'

type Tab = 'history' | 'comments'
/**
 * Where the private-notes gate is open for this deployment: a member's encrypted comments panel for a note (lazy private
 * chunk), or null (a guest, a key not available yet): placeholders. Undefined where the gate is closed: no panel at all.
 */
export type PrivateComments = ((note: ChainNote, onCount: (count: number, more: boolean) => void) => ReactNode) | null
type Props = {
    note: ChainNote; client: NotesReadClient; store: NotesStore; owner: string | null; previewRoot: HTMLElement | null
    /** "Use as draft" from History: copies archived content into the editor, never signs. */
    onRestore?: HistoryRestore
    /** Kept mounted (an unsent comment stays) but not shown, e.g. while the note is being edited. */
    hidden?: boolean
    /** A private note's encrypted comments (lazy private chunk). Without it a private note lists them as placeholders. */
    privateComments?(onCount: (count: number, more: boolean) => void): ReactNode
}

/**
 * History | Comments beside the note. At phone width the tabs sit under the note and open a
 * full-screen sheet with Back. Both tabs stay mounted, so switching never drops a comment.
 */
export function NoteSidePanel({ note, client, store, owner, previewRoot, onRestore, hidden, privateComments }: Props) {
    // A private note keeps no public history: only its comments.
    const encrypted = note.mode < 3
    const [tab, setTab] = useState<Tab>(encrypted ? 'comments' : 'history'), [sheet, setSheet] = useState(false)
    const [count, setCount] = useState<{ n: number; more: boolean } | null>(null)
    const id = useId(), side = useNotesPane()?.side, aside = useRef<HTMLElement>(null), back = useRef<HTMLButtonElement>(null)
    /** Where the note was scrolled when the sheet opened: closing the sheet goes back there. */
    const saved = useRef<{ scroller: HTMLElement; top: number } | null>(null)
    // An opened sheet takes the focus (its Back first) and opens at its top; closing it returns the focus to the tab that opened it.
    useEffect(() => {
        if (!sheet || !aside.current) return
        back.current?.focus({ preventScroll: true })
        const scroller = scrollingParent(aside.current)
        if (scroller) scroller.scrollTop += aside.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    }, [sheet])
    useLayoutEffect(() => {
        if (sheet || !saved.current) return
        const { scroller, top } = saved.current
        saved.current = null; scroller.scrollTop = top
    }, [sheet])
    // "Show in note" on a comment: the sheet steps aside (synchronously), so the quote can be shown in the note.
    useEffect(() => {
        const element = aside.current
        if (!element) return
        const reveal = () => { if (element.hasAttribute('data-sheet')) { saved.current = null; flushSync(() => setSheet(false)) } }
        element.addEventListener(REVEAL_QUOTE, reveal)
        return () => element.removeEventListener(REVEAL_QUOTE, reveal)
    }, [])
    function closeSheet() {
        setSheet(false)
        aside.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${id}-${tab}`)}`)?.focus({ preventScroll: true })
    }
    const tabs: Tab[] = encrypted ? ['comments'] : ['history', 'comments']
    // The sheet only exists in a narrow note column (the stylesheet says which): a wide one never keeps one open for later.
    function choose(next: Tab) {
        const open = !!aside.current && getComputedStyle(aside.current).getPropertyValue('--os-notes-sheet').trim() === '1'
        if (open && !sheet && aside.current) { const scroller = scrollingParent(aside.current); saved.current = scroller && { scroller, top: scroller.scrollTop } }
        setTab(next); setSheet(open)
    }
    function keys(event: KeyboardEvent<HTMLButtonElement>) {
        const index = tabs.indexOf(tab)
        const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
            : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null
        if (!next) return
        event.preventDefault(); setTab(next)
        event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${id}-${next}`)}`)?.focus()
    }
    const label = (value: Tab) => value === 'history' ? 'History' : `Comments${count ? ` · ${count.n}${count.more ? '+' : ''}` : ''}`
    const panel = <aside ref={aside} className="os-notes-side" aria-label="History and comments" data-sheet={sheet ? 'open' : undefined} hidden={hidden}
        onKeyDown={event => { if (sheet && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSheet() } }}>
        <button ref={back} type="button" className="os-btn os-quiet os-notes-side-back" aria-label="Back to the note" onClick={closeSheet}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>Note
        </button>
        <div className="os-notes-side-tabs" role="tablist" aria-label="History and comments">
            {tabs.map(value => <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-${value}-panel`} aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1} onKeyDown={keys} onClick={() => choose(value)}>{label(value)}</button>)}
        </div>
        {!encrypted && <div className="os-notes-side-body" role="tabpanel" id={`${id}-history-panel`} aria-labelledby={`${id}-history`} hidden={tab !== 'history'}>
            <PublicHistory noteId={note.id} client={client} onRestore={onRestore} viewer={owner} />
        </div>}
        <div className="os-notes-side-body" role="tabpanel" id={`${id}-comments-panel`} aria-labelledby={`${id}-comments`} hidden={tab !== 'comments'}>
            {encrypted && privateComments ? privateComments((n, more) => setCount({ n, more }))
                : <PublicCommentPanel note={note} client={client} owner={owner} store={store} previewRoot={previewRoot} onCount={(n, more) => setCount({ n, more })} />}
        </div>
    </aside>
    return side ? createPortal(panel, side) : panel
}

/** The element that scrolls the sheet: the note column in a window, the screen on a phone. */
function scrollingParent(element: HTMLElement): HTMLElement | null {
    for (let node = element.parentElement; node; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY
        if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
    }
    return null
}
