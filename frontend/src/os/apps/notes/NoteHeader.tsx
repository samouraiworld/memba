import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDialogKeys } from '../../shell/useDialogKeys'
import { NoteDeskButton } from './NoteDeskButton'
import { useNotesPane } from './notesPane'

/**
 * Places the Share, comments and history features (PR 5) take in a note's page.
 * `panel` is the right-hand region beside the note (history, comments).
 */
export interface NoteSlots { shareSlot?: ReactNode; commentsSlot?: ReactNode; historyAction?: () => void; panel?: ReactNode }
export interface NoteMenuItem { label: string; hint?: string; danger?: boolean; run(): void }
/** One message at the top of a note: what happened, that the text is kept, what to do next. */
export interface Notice { tone: 'info' | 'warn' | 'error' | 'pending'; text: string; title?: string; actions?: ReactNode }

const icons = {
    ok: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>,
    lock: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
    more: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>,
}
/** The state of the note in one line, with a mark for its kind. */
export function NoteStatus({ kind, children }: { kind: 'published' | 'draft' | 'changes' | 'private'; children: ReactNode }) {
    return <span className="os-notes-state" data-kind={kind}>
        {kind === 'published' ? icons.ok : kind === 'private' ? icons.lock : <span className="os-notes-dot" aria-hidden="true" />}{children}
    </span>
}

/** The note's header: its status, then one primary action, Share and the ⋯ menu. */
export function NoteHeader({ noteId, status, actions, primary, slots, menu = [], published = false }: {
    noteId: string; status: ReactNode; actions?: ReactNode; primary?: ReactNode; slots?: NoteSlots; menu?: NoteMenuItem[]; published?: boolean
}) {
    const [copied, setCopied] = useState('')
    const link = `${location.origin}/os/notes/${noteId}`
    async function copy() {
        try { await navigator.clipboard.writeText(link); setCopied('Link copied.') } catch { setCopied('The link could not be copied. Use the address in the window URL.') }
    }
    const items: NoteMenuItem[] = [
        ...slots?.historyAction ? [{ label: 'History', run: slots.historyAction }] : [],
        ...published ? [{ label: 'Copy link', run: () => void copy() }] : [],
        ...menu,
    ]
    return <header className="os-notes-head">
        <div className="os-notes-status" role="status">{status}{copied && <span className="os-notes-copied"> · {copied}</span>}</div>
        <div className="os-notes-head-actions">
            {slots?.commentsSlot}
            {/* Until the Share menu exists, Share copies the note's link. */}
            {slots?.shareSlot ?? (published && <button type="button" className="os-btn os-quiet" onClick={() => void copy()}>Share</button>)}
            {actions}
            {primary}
            <NoteMenu noteId={noteId} items={items} />
        </div>
    </header>
}

function NoteMenu({ noteId, items }: { noteId: string; items: NoteMenuItem[] }) {
    const [open, setOpen] = useState(false), id = useId(), root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (!open) return
        const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
        document.addEventListener('pointerdown', outside)
        root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
        return () => document.removeEventListener('pointerdown', outside)
    }, [open])
    const close = () => { setOpen(false); button.current?.focus() }
    function keys(event: KeyboardEvent) {
        const all = [...root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []], at = all.indexOf(document.activeElement as HTMLElement)
        if (event.key === 'Escape') { event.preventDefault(); close() }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); all[(at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus() }
        else if (event.key === 'Tab') setOpen(false)
    }
    const danger = items.filter(item => item.danger), plain = items.filter(item => !item.danger)
    const entry = (item: NoteMenuItem) => <button key={item.label} type="button" role="menuitem" className="os-notes-menu-item" data-danger={item.danger || undefined} onClick={() => { setOpen(false); item.run() }}>
        {item.label}{item.hint && <small>{item.hint}</small>}
    </button>
    return <div className="os-notes-more" ref={root} onKeyDown={open ? keys : undefined}>
        <button ref={button} type="button" className="os-btn os-quiet os-notes-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>{icons.more}</button>
        {open && <div id={id} className="os-notes-menu" role="menu" aria-label="More actions">
            {plain.map(entry)}
            <NoteDeskButton noteId={noteId} role="menuitem" className="os-notes-menu-item" onDone={() => setOpen(false)} />
            {danger.length > 0 && <div className="os-notes-menu-sep" role="separator" />}
            {danger.map(entry)}
        </div>}
    </div>
}

const toneIcon = {
    info: <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />,
    warn: <path d="M12 3 2 20h20ZM12 10v4M12 17h.01" />,
    error: <path d="M12 3 2 20h20ZM12 10v4M12 17h.01" />,
}
export function NoteBanner({ notice }: { notice: Notice | null }) {
    if (!notice) return null
    const urgent = notice.tone === 'warn' || notice.tone === 'error'
    return <div className="os-notes-banner" data-tone={notice.tone} role={urgent ? 'alert' : 'status'}>
        {notice.tone === 'pending' ? <span className="os-spin" aria-hidden="true" />
            : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">{toneIcon[notice.tone]}</svg>}
        <p>{notice.title && <b>{notice.title} </b>}{notice.text}</p>
        {notice.actions && <div className="os-notes-banner-actions">{notice.actions}</div>}
    </div>
}

/**
 * A sheet over the note side of the Notes window. It shows only while its note is the one on screen,
 * so a hidden note's publication never covers another note.
 */
export function NoteSheet({ label, onClose, children }: { label: string; onClose?(): void; children: ReactNode }) {
    const pane = useNotesPane(), dialog = useRef<HTMLDivElement>(null)
    const shown = pane?.shown ?? true
    useDialogKeys(dialog, shown, 'button:not(:disabled), input:not(:disabled), summary, select:not(:disabled)', onClose)
    useEffect(() => { if (shown) dialog.current?.focus({ preventScroll: true }) }, [shown])
    if (!shown) return null
    const sheet = <div className="os-notes-scrim">
        <div ref={dialog} className="os-notes-sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
            onKeyDown={event => { if (event.key === 'Escape' && onClose) { event.preventDefault(); onClose() } }}>{children}</div>
    </div>
    return pane?.overlay ? createPortal(sheet, pane.overlay) : sheet
}
