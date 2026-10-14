import { useEffect, useState } from 'react'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import { readPublicContentWritePermission } from '../../../lib/notes/chain/publicPermissions'

/** The page's primary action while reading: shown only to accounts that may publish changes. */
export function PublicEditButton({ client, note, owner, busy = false, onEdit }: { client: NotesReadClient; note: ChainNote; owner: string; busy?: boolean; onEdit(note: ChainNote): void }) {
    const key = JSON.stringify([owner, note.id, note.owner, note.stateRevision, note.ownerGeneration, note.mode, note.deleted]), [permission, setPermission] = useState<{ key: string; client: NotesReadClient; allowed: boolean } | null>(null)
    useEffect(() => {
        let alive = true
        void readPublicContentWritePermission(client, note, owner).then(allowed => { if (alive) setPermission({ key, client, allowed }) }).catch(() => { if (alive) setPermission({ key, client, allowed: false }) })
        return () => { alive = false }
    }, [client, note, owner, key])
    if (permission?.key !== key || permission.client !== client || !permission.allowed) return null
    return <button className="os-btn" disabled={busy} onClick={() => onEdit(structuredClone(note))}>{busy ? 'Opening…' : 'Edit'}</button>
}
