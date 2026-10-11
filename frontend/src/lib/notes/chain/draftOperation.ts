import type { DraftBase, DraftRecord } from '../drafts'
import { trimPublicTitle } from '../publicFields'
import type { PublicNoteOperation } from './messages'
import { check, NotesChainError, publicText, type ChainNote } from './schema'

export function draftBase(note: ChainNote): DraftBase {
    return { stateRevision: note.stateRevision, epoch: note.epoch, ownerGeneration: note.ownerGeneration, titleRevision: note.titleRevision, bodyRevision: note.bodyRevision }
}
/** Only the baseline saved when editing may authorize an update; a missing baseline means create. */
export function draftPublicOperation(draft: DraftRecord, operationId: string, mode: 3 | 4, maxFeeUgnot: string): PublicNoteOperation {
    check(draft.payload.kind === 'public' && draft.scope.owner !== 'guest')
    const { body, base } = draft.payload, title = trimPublicTitle(draft.payload.title)
    publicText(new TextEncoder().encode(title), true); publicText(new TextEncoder().encode(body))
    return {
        caller: draft.scope.owner, noteId: draft.scope.noteId, operationId,
        action: base ? { kind: 'commit', revision: base.stateRevision, epoch: base.epoch, title, body }
            : { kind: 'create', mode, title, body, maxFeeUgnot },
    }
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((byte, i) => byte === b[i])
}
/**
 * The realm re-stores (and charges for) every field named in field_mask, even with
 * identical bytes, and advances that field's revision. Keep only the fields whose
 * UTF-8 bytes differ from the published note the commit is based on.
 */
export function changedPublicFields(operation: PublicNoteOperation, published: Pick<ChainNote, 'title' | 'body'>): PublicNoteOperation {
    const a = operation.action
    if (a.kind !== 'commit') return operation
    check(published.body !== undefined)
    const encode = (value: string) => new TextEncoder().encode(value)
    const title = a.title !== undefined && !sameBytes(encode(a.title), published.title) ? a.title : undefined
    const body = a.body !== undefined && !sameBytes(encode(a.body), published.body) ? a.body : undefined
    if (title === undefined && body === undefined) throw new NotesChainError('unchanged')
    const action: typeof a = { kind: 'commit', revision: a.revision, epoch: a.epoch }
    if (title !== undefined) action.title = title
    if (body !== undefined) action.body = body
    return { ...operation, action }
}
