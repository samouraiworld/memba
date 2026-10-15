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
    const [notes, setNotes] = useState<{ client: NotesReadClient; items: ChainNote[] } | null>(null)
    const [titles, setTitles] = useState<ReadonlyMap<string, string | null> | null>(null)
    useEffect(() => { if (controller.getSnapshot().phase === 'unknown') void withKey(controller, () => controller.refresh()).catch(() => {}) }, [controller])
    // Only an account with a key can be a reader. The first page; a failed read shows nothing (it never proves absence).
    useEffect(() => {
        if (!keyed) return
        let alive = true
        void Promise.resolve().then(() => client.sharedWith(owner, '', PAGE_SIZE)).then(page => {
            if (alive) setNotes({ client, items: page.items.filter(note => note.owner !== owner && note.mode <= 2 && !note.deleted) })
        }).catch(() => {})
        return () => { alive = false }
    }, [keyed, client, owner])
    const items = notes?.client === client ? notes.items : NONE
    useEffect(() => {
        if (phase !== 'unlocked' || !items.length) return
        const lifetime = new AbortController()
        void withKey(controller, () => readEncryptedTitles(client, items, { owner, identity: controller, signal: lifetime.signal }))
            .then(read => { if (!lifetime.signal.aborted) setTitles(read) }).catch(() => {})
        return () => { lifetime.abort(); setTitles(null) }
    }, [phase, generation, items, controller, client, owner])
    if (!keyed || !items.length) return null
    return <>
        <h2 className="os-notes-group">Shared with me</h2>
        <ul className="os-notes-rows">{items.map(note => <li key={note.id}>
            <button type="button" className="os-notes-row" aria-current={note.id === selected ? 'true' : undefined} onClick={() => onOpen(note.id)}>
                <span className="os-notes-row-title">{(phase === 'unlocked' && titles?.get(note.id)) || 'Private note'}</span>
                <span className="os-notes-row-meta"><span className="os-notes-pill" data-state="private">Private</span>Shared by {shortAddress(note.owner)}</span>
            </button>
        </li>)}</ul>
    </>
}
