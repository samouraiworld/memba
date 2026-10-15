import type { SignRequest } from '../../../sign/signer'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { draftBase } from '../../../../lib/notes/chain/draftOperation'
import type { ChainNote } from '../../../../lib/notes/chain/schema'
import { privateNotesDeployment } from '../../../../lib/notes/config'
import { saveDraftBounded } from '../../../../lib/notes/draftSlot'
import { createDraftSession, type NotesScope, type NotesStore } from '../../../../lib/notes/drafts'
import { sealPrivateDraft } from '../../../../lib/notes/private'

/** The registered key a draft is sealed for: only its public half, so saving needs no unlock. */
export interface DraftKey { generation: string; publicKey: Uint8Array }
export const privateOpen = (client: NotesReadClient) => privateNotesDeployment(client.chainId)?.realm === client.realm
/**
 * Stores `text` as this device's encrypted draft of the confirmed `note` (its baseline), in place of the record at
 * `expectedRevision` (compare-and-swap: a draft changed meanwhile is kept). Refused while private notes are closed.
 */
export async function sealConfirmedDraft(store: NotesStore, client: NotesReadClient, scope: NotesScope, expectedRevision: string, key: DraftKey, text: { title: string; body: string }, note: ChainNote): Promise<boolean> {
    const mode = note.mode
    if (!privateOpen(client) || mode > 2) return false
    const envelope = sealPrivateDraft(scope, BigInt(expectedRevision) + 1n, BigInt(key.generation), key.publicKey, { ...text, mode: mode as 0 | 1 | 2, base: draftBase(note) })
    const result = await saveDraftBounded(store, scope, expectedRevision, { kind: 'encrypted', envelope }, createDraftSession())
    return result.status === 'saved'
}
/** Once the request's own check confirms it, `after` runs (bounded, its failure ignored) before the page is told. */
export function afterConfirmed(request: SignRequest, after: () => Promise<unknown>): void {
    const verify = request.verify
    if (!verify) return
    let done = false
    request.verify = async (...args) => {
        const ok = await verify(...args)
        if (ok === true && !done) { done = true; await after().catch(() => false) }
        return ok
    }
}
