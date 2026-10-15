import { useEffect, useState, useSyncExternalStore } from 'react'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import type { ChainNote } from '../../../../lib/notes/chain/schema'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { privateNotesDeployment } from '../../../../lib/notes/config'
import { readEncryptedTitles } from '../../../../lib/notes/private'
import { shortAddress } from '../notesFormat'
import { withKey } from './keyQueue'

export interface SharedWithMeProps {
    controller: NotesIdentityController; client: NotesReadClient; owner: string; selected: string | null; onOpen(id: string): void
}
const PAGE_SIZE = 20, NONE: ChainNote[] = []
/**
 * "Shared with me": private notes other accounts shared with this one (the realm's public reader index). Titles are
 * decrypted only while the key is unlocked, kept in this list alone (never the desk, the address or telemetry), and
 * dropped when it locks.
 */
export function SharedWithMe(props: SharedWithMeProps) {
    if (privateNotesDeployment(props.client.chainId)?.realm !== props.client.realm) return null
    return <List {...props} />
}
function List({ controller, client, owner, selected, onOpen }: SharedWithMeProps) {
    const { phase, generation } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const keyed = phase === 'locked' || phase === 'unlocked'
    const [notes, setNotes] = useState<{ client: NotesReadClient; items: ChainNote[]; next: string } | null>(null), [more, setMore] = useState(false)
    const [titles, setTitles] = useState<ReadonlyMap<string, string | null> | null>(null)
    useEffect(() => { if (controller.getSnapshot().phase === 'unknown') void withKey(controller, () => controller.refresh()).catch(() => {}) }, [controller])
    // The reader index also lists the account's own notes (an owner reads them): those are skipped, following up to
    // five pages so that a page of only them never hides what others shared.
    async function collect(cursor: string): Promise<{ items: ChainNote[]; next: string }> {
        const items: ChainNote[] = []
        for (let pages = 0; pages < 5 && (pages === 0 || cursor) && !items.length; pages++) {
            const page = await client.sharedWith(owner, cursor, PAGE_SIZE)
            items.push(...page.items.filter(note => note.owner !== owner && note.mode <= 2 && !note.deleted)); cursor = page.nextCursor
        }
        return { items, next: cursor }
    }
    // Only an account with a key can be a reader. The first page, then "Show more"; a failed read shows nothing more
    // (it never proves absence).
    useEffect(() => {
        if (!keyed) return
        let alive = true
        void collect('').then(page => { if (alive) setNotes({ client, ...page }) }).catch(() => {})
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- collect reads only the client and the owner.
    }, [keyed, client, owner])
    async function showMore() {
        const current = notes
        if (more || !current || current.client !== client || !current.next) return
        setMore(true)
        try {
            const page = await collect(current.next), known = new Set(current.items.map(note => note.id))
            setNotes(latest => latest === current ? { client, items: [...current.items, ...page.items.filter(note => !known.has(note.id))], next: page.next } : latest)
        } catch { /* kept as is; the button stays to try again */ } finally { setMore(false) }
    }
    const items = notes?.client === client ? notes.items : NONE
    useEffect(() => {
        if (phase !== 'unlocked' || !items.length) return
        const lifetime = new AbortController()
        void withKey(controller, () => readEncryptedTitles(client, items, { owner, identity: controller, signal: lifetime.signal }))
            .then(read => { if (!lifetime.signal.aborted) setTitles(read) }).catch(() => {})
        return () => { lifetime.abort(); setTitles(null) }
    }, [phase, generation, items, controller, client, owner])
    if (!keyed || !(items.length || (notes?.client === client && notes.next))) return null
    return <>
        <h2 className="os-notes-group">Shared with me</h2>
        <ul className="os-notes-rows">{items.map(note => <li key={note.id}>
            <button type="button" className="os-notes-row" aria-current={note.id === selected ? 'true' : undefined} onClick={() => onOpen(note.id)}>
                <span className="os-notes-row-title">{(phase === 'unlocked' && titles?.get(note.id)) || 'Private note'}</span>
                <span className="os-notes-row-meta"><span className="os-notes-pill" data-state="private">Private</span>Shared by {shortAddress(note.owner)}</span>
            </button>
        </li>)}</ul>
        {notes?.client === client && notes.next && <button type="button" className="os-btn os-quiet os-notes-more" disabled={more} onClick={() => void showMore()}>{more ? 'Loading…' : 'Show more'}</button>}
    </>
}
