import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { DraftSession } from '../drafts'
import { validPublicVerification } from '../intents'
import type { NotesIntent, NotesIntentInput, NotesIntents, NotesOperationEvidence, PublicIntentVerification } from '../intents'
import type { NotesReadClient } from './client'
import type { PublicNoteOperation } from './messages'
import { check, decimal, NOTES_REALM } from './schema'
import type { ChainNote } from './schema'

const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes))
const utf8 = (value: string) => new TextEncoder().encode(value)
const increment = (value: string) => decimal((BigInt(value) + 1n).toString(), 64, true)
/** Freeze the expected public result before opening the wallet; no plaintext is persisted here. */
export function publicVerification(operation: PublicNoteOperation, base: ChainNote | null, quoteHeight: string): PublicIntentVerification {
  const a = operation.action, creating = a.kind === 'create', deleted = a.kind === 'delete'
  check(creating || (base && base.mode >= 3 && !base.deleted && base.body !== undefined))
  const title = a.kind === 'create' || a.kind === 'rename' || a.kind === 'commit' ? a.title : undefined
  const body = a.kind === 'create' || a.kind === 'commit' ? a.body : undefined
  const value = {
    kind: 'public-v1' as const, mode: creating ? a.mode : a.kind === 'comments' ? (a.open ? 4 : 3) : base!.mode,
    epoch: creating ? '0' : base!.epoch, deleted, quoteHeight, owner: creating ? operation.caller : base!.owner,
    titleSha256: hash(deleted ? new Uint8Array() : title === undefined ? base!.title : utf8(title)),
    bodySha256: hash(deleted ? new Uint8Array() : body === undefined ? base!.body! : utf8(body)),
    ownerGeneration: base?.ownerGeneration ?? '1',
    titleRevision: creating ? '1' : title === undefined ? base!.titleRevision : increment(base!.titleRevision),
    bodyRevision: creating ? '1' : body === undefined ? base!.bodyRevision : increment(base!.bodyRevision),
  }
  check(validPublicVerification(value)); return value
}
/** A receipt alone is insufficient: match the reviewed public result, including tombstone bytes. */
export function publicIntentEvidence(input: NotesIntentInput, note: ChainNote | null): NotesOperationEvidence | null {
  const v = input.verification
  if (!validPublicVerification(v) || !note || input.scope.realm !== NOTES_REALM || note.id !== input.scope.noteId
    || note.operationId !== input.operationId || note.actor !== input.actor || note.owner !== (v.owner ?? input.actor)
    || note.stateRevision !== input.resultingStateRevision || note.ownerGeneration !== input.ownerGeneration
    || note.ownerGeneration !== v.ownerGeneration || note.mode !== v.mode || note.epoch !== v.epoch
    || note.deleted !== v.deleted || note.titleRevision !== v.titleRevision || note.bodyRevision !== v.bodyRevision
    || note.body === undefined || note.commitment.length !== 0 || BigInt(note.height) <= BigInt(v.quoteHeight)
    || hash(note.title) !== v.titleSha256 || hash(note.body) !== v.bodySha256
    || (v.deleted && (note.listed || note.pendingOwner || note.title.length || note.body.length))) return null
  return { scope: { ...input.scope }, operationId: note.operationId, actor: note.actor, stateRevision: note.stateRevision, height: note.height, outcome: 'applied' }
}

/** Reload recovery is read-only on chain, never retries, and leaves drafts and historical receipts intact.
 * Call this from an explicit Check outcome action. Old receipts without a public descriptor stay unknown.
 * A later last-operation receipt cannot establish an earlier operation; it needs future historical proof.
 */
export async function recoverPublicIntent(
  client: Pick<NotesReadClient, 'chainId' | 'assertCurrent' | 'note'>,
  intents: NotesIntents, intent: NotesIntent, session: DraftSession,
): Promise<'confirmed' | 'unknown'> {
  const guard = session.capture(), scope = { ...intent.scope }, operationId = intent.operationId
  const current = () => { if (guard.signal.aborted) throw new Error('Session changed.'); client.assertCurrent() }
  try {
    current(); if (client.chainId !== scope.chainId || scope.realm !== NOTES_REALM) return 'unknown'
    // Read the durable snapshot instead of a caller-owned object or a possibly changed local draft.
    const stored = await intents.get(scope, operationId); current()
    if (!stored || !validPublicVerification(stored.verification)) return 'unknown'
    if (stored.phase === 'confirmed') return 'confirmed'
    if (!['prepared', 'submitted', 'unknown'].includes(stored.phase)) return 'unknown'
    const note = await client.note(scope.noteId); current()
    const evidence = publicIntentEvidence(stored, note)
    if (!evidence) return 'unknown'
    const result = await intents.confirm(scope, operationId, evidence, guard); current()
    return result.status === 'saved' ? 'confirmed' : 'unknown'
  } catch { return 'unknown' }
}
