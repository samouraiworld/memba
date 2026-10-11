import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesStore } from '../../../lib/notes/drafts'
import { PublicCommentPanel } from './PublicCommentPanel'
import { PublicHistory } from './PublicHistory'
import type { HistoryRestore } from './PublicHistoryContent'
import { useNotesPane } from './notesPane'
import './notes-history.css'

type Tab = 'history' | 'comments'
type Props = {
    note: ChainNote; client: NotesReadClient; store: NotesStore; owner: string | null; previewRoot: HTMLElement | null
    /** "Use as draft" from History: copies archived content into the editor, never signs. */
    onRestore?: HistoryRestore
    /** Kept mounted (an unsent comment stays) but not shown, e.g. while the note is being edited. */
    hidden?: boolean
}

/**
 * History | Comments beside the note. At phone width the tabs sit under the note and open a
 * full-screen sheet with Back. Both tabs stay mounted, so switching never drops a comment.
 */
export function NoteSidePanel({ note, client, store, owner, previewRoot, onRestore, hidden }: Props) {
    const [tab, setTab] = useState<Tab>('history'), [sheet, setSheet] = useState(false)
    const [count, setCount] = useState<{ n: number; more: boolean } | null>(null)
    const id = useId(), side = useNotesPane()?.side, aside = useRef<HTMLElement>(null)
    const comments = note.mode >= 3
    const tabs: Tab[] = comments ? ['history', 'comments'] : ['history']
    // The sheet only exists in a narrow note column (the stylesheet says which): a wide one never keeps one open for later.
    function choose(next: Tab) { setTab(next); setSheet(!!aside.current && getComputedStyle(aside.current).getPropertyValue('--os-notes-sheet').trim() === '1') }
    function keys(event: KeyboardEvent<HTMLButtonElement>) {
        const index = tabs.indexOf(tab)
        const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
            : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null
        if (!next) return
        event.preventDefault(); setTab(next)
        event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${id}-${next}`)}`)?.focus()
    }
    const label = (value: Tab) => value === 'history' ? 'History' : `Comments${count ? ` · ${count.n}${count.more ? '+' : ''}` : ''}`
    const panel = <aside ref={aside} className="os-notes-side" aria-label="History and comments" data-sheet={sheet ? 'open' : undefined} hidden={hidden}>
        <button type="button" className="os-btn os-quiet os-notes-side-back" aria-label="Back to the note" onClick={() => setSheet(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>Note
        </button>
        <div className="os-notes-side-tabs" role="tablist" aria-label="History and comments">
            {tabs.map(value => <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-${value}-panel`} aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1} onKeyDown={keys} onClick={() => choose(value)}>{label(value)}</button>)}
        </div>
        <div className="os-notes-side-body" role="tabpanel" id={`${id}-history-panel`} aria-labelledby={`${id}-history`} hidden={tab !== 'history'}>
            <PublicHistory noteId={note.id} client={client} onRestore={onRestore} viewer={owner} />
        </div>
        {comments && <div className="os-notes-side-body" role="tabpanel" id={`${id}-comments-panel`} aria-labelledby={`${id}-comments`} hidden={tab !== 'comments'}>
            <PublicCommentPanel note={note} client={client} owner={owner} store={store} previewRoot={previewRoot} onCount={(n, more) => setCount({ n, more })} />
        </div>}
    </aside>
    return side ? createPortal(panel, side) : panel
}
