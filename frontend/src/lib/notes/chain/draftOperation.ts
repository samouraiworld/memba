import type { DraftBase, DraftRecord } from '../drafts'
import type { PublicNoteOperation } from './messages'
import { check, publicText, type ChainNote } from './schema'

export function draftBase(note: ChainNote): DraftBase {
    return { stateRevision: note.stateRevision, epoch: note.epoch, ownerGeneration: note.ownerGeneration, titleRevision: note.titleRevision, bodyRevision: note.bodyRevision }
}
/** Only the baseline saved when editing may authorize an update; a missing baseline means create. */
export function draftPublicOperation(draft: DraftRecord, operationId: string, mode: 3 | 4, maxFeeUgnot: string): PublicNoteOperation {
    check(draft.payload.kind === 'public' && draft.scope.owner !== 'guest')
    const { title, body, base } = draft.payload
    publicText(new TextEncoder().encode(title), true); publicText(new TextEncoder().encode(body))
    return {
        caller: draft.scope.owner, noteId: draft.scope.noteId, operationId,
        action: base ? { kind: 'commit', revision: base.stateRevision, epoch: base.epoch, title, body }
            : { kind: 'create', mode, title, body, maxFeeUgnot },
    }
}
