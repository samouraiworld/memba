import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ACTIVE_NETWORK_KEY } from '../../../lib/config'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { publicText, type ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesStore } from '../../../lib/notes/drafts'
import { PublicCollaborationControls } from './PublicCollaborationControls'
import './notes-history.css'

type Props = { note: ChainNote; client: NotesReadClient; store: NotesStore; owner: string | null; onChanged(): void
    /** The network in the link; Notes reads only the active network (the client is bound to it). */
    networkKey?: string
    /** A private note's "Who can read" (lazy private chunk), rendered once the menu was first opened. */
    privateReaders?(): ReactNode }

function noteTitle(note: ChainNote) { try { return publicText(note.title, true) } catch { return 'note' } }

/**
 * The note header's Share menu: the link, who can read, who can edit (the owner changes it here,
 * with its cost, and follows it to confirmation) and who can comment. The panel stays mounted
 * while closed, so a change being signed keeps its progress when the menu is reopened.
 */
export function NoteSharePopover({ note, client, store, owner, networkKey = ACTIVE_NETWORK_KEY, onChanged, privateReaders }: Props) {
    const [open, setOpen] = useState(false), [copied, setCopied] = useState<'' | 'yes' | 'no'>('')
    /** Read on first open only; then kept, so a change being signed survives closing the menu. */
    const [used, setUsed] = useState(false)
    const id = useId(), box = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
    const link = `${window.location.origin}/${networkKey}/os/notes/${note.id}`
    useEffect(() => {
        if (!open) return
        panel.current?.focus({ preventScroll: true })
        const outside = (event: MouseEvent) => {
            const target = event.target as Element | null
            // The review sheet the menu opened is another dialog: using it never closes the menu.
            if (!target || box.current?.contains(target) || target.closest?.('[role="dialog"], .os-scrim')) return
            setOpen(false)
        }
        document.addEventListener('mousedown', outside)
        return () => document.removeEventListener('mousedown', outside)
    }, [open])
    function close() { setOpen(false); button.current?.focus() }
    async function copy() {
        try { await navigator.clipboard.writeText(link); setCopied('yes') } catch { setCopied('no') }
    }
    return <div className="os-notes-share" ref={box} onBlur={event => {
        // Focus leaving the menu closes it, unless it moved into the review sheet the menu opened.
        const next = event.relatedTarget as Element | null
        if (open && next && !box.current?.contains(next) && !next.closest?.('[role="dialog"], .os-scrim')) setOpen(false)
    }}>
        <button ref={button} type="button" className="os-btn os-quiet" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
            onClick={() => { setOpen(value => !value); setUsed(true); setCopied('') }}>Share</button>
        <div ref={panel} id={id} className="os-notes-share-pop" role="dialog" aria-label={`Share ${noteTitle(note)}`} tabIndex={-1} hidden={!open}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
            <section className="os-notes-share-part" aria-label="Link">
                <h3 className="os-notes-share-k">Link</h3>
                <div className="os-notes-share-link">
                    <code>{link}</code>
                    <button type="button" className="os-btn os-quiet" aria-label={copied === 'yes' ? 'Copied' : 'Copy link'} onClick={() => void copy()}>{copied === 'yes' ? 'Copied' : 'Copy'}</button>
                </div>
                {copied === 'no' && <p role="status">Your browser blocked the clipboard. Select the link to copy it.</p>}
                <p className="os-notes-share-note">{note.mode < 3 ? 'Private note: the link opens it only for its owner and the people it is shared with, after they unlock their private key.'
                    : 'Public note: anyone, with or without a wallet, can read it. Chosen when it was first published.'}</p>
            </section>
            {used && (note.mode < 3 ? privateReaders?.() : <PublicCollaborationControls note={note} client={client} store={store} owner={owner} onChanged={onChanged} />)}
            {!note.deleted && note.mode >= 3 && <section className="os-notes-share-part" aria-label="Who can comment">
                <h3 className="os-notes-share-k">Who can comment</h3>
                {/* As the realm's comment check (mayComment). Restricting comments also closes community editing there. */}
                <p><strong>{note.mode === 4 ? 'Everyone with a wallet' : 'The owner, the named writers, governance members when governance owns the note, and wallets the note\'s comment policy allows'}</strong></p>
                <p className="os-notes-share-note">The owner can change this later; restricting comments also stops community editing. Memba does not offer that change yet.</p>
            </section>}
        </div>
    </div>
}
