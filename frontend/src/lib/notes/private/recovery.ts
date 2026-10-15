import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { DraftSession } from '../drafts'
import { validPrivateVerification } from '../intents'
import type { NotesIntent, NotesIntentInput, NotesIntents, NotesOperationEvidence, PrivateIntentVerification } from '../intents'
import type { NotesReadClient } from '../chain/client'
import type { ChainNote } from '../chain/schema'
import { address, check } from '../chain/schema'
import type { PrivateNoteOperation } from './messages'
import { readPrivateAccess } from './reader'

const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes))
/** Hashes ONLY ciphertext and envelopes (F07): no plaintext, no plaintext hash and no key enters the durable receipt. */
export function privateVerification(operation: PrivateNoteOperation, quoteHeight: string, maxDepositUgnot: string): PrivateIntentVerification {
  const p = operation.action.prepared
  const value: PrivateIntentVerification = {
    kind: 'private-v1', mode: p.mode, epoch: String(p.epoch), owner: operation.caller, pendingOwner: '', ownerGeneration: '1',
    titleRevision: String(p.titleRevision), bodyRevision: String(p.bodyRevision), titleBlobSha256: hash(p.title), bodyBlobSha256: hash(p.body),
    commitmentSha256: hash(p.commitment), manifestSha256: hash(p.manifest), revealedEpoch: '0', revealedCommitment: '', quoteHeight, maxDepositUgnot,
  }
  check(validPrivateVerification(value)); return value
}
/** Exact evidence for this operation: its receipt, ciphertexts, commitment and envelopes on chain. Never inferred from absence. */
export async function privateIntentEvidence(client: NotesReadClient, input: NotesIntentInput, note: ChainNote | null, signal: AbortSignal): Promise<NotesOperationEvidence | null> {
  const current = () => { check(!signal.aborted); client.assertCurrent() }
  current(); const v = input.verification
  if (!validPrivateVerification(v) || input.action !== 'private-create' || !note || input.scope.chainId !== client.chainId || input.scope.realm !== client.realm || note.id !== input.scope.noteId
    || note.deleted || note.operationId !== input.operationId || note.actor !== input.actor || note.owner !== v.owner || note.pendingOwner !== v.pendingOwner
    || note.ownerGeneration !== input.ownerGeneration || note.ownerGeneration !== v.ownerGeneration || note.stateRevision !== input.resultingStateRevision
    || note.mode !== v.mode || note.epoch !== v.epoch || note.titleRevision !== v.titleRevision || note.bodyRevision !== v.bodyRevision
    || note.body === undefined || BigInt(note.height) <= BigInt(v.quoteHeight) || hash(note.commitment) !== v.commitmentSha256
    || hash(note.title) !== v.titleBlobSha256 || hash(note.body) !== v.bodyBlobSha256) return null
  address(v.owner)
  if (hash(await readPrivateAccess(client, note, signal)) !== v.manifestSha256) return null
  current()
  const final = await client.noteMetadata(note.id); current()
  if (!final || final.operationId !== note.operationId || final.stateRevision !== note.stateRevision || final.ownerGeneration !== note.ownerGeneration || final.epoch !== note.epoch) return null
  return { scope: { ...input.scope }, operationId: note.operationId, actor: note.actor, stateRevision: note.stateRevision, height: note.height, outcome: 'applied' }
}
/** Explicit reload reconciliation, without any key. It never retries a transaction or deletes a draft or a receipt. */
export async function recoverPrivateIntent(client: NotesReadClient, intents: NotesIntents, intent: NotesIntent, session: DraftSession): Promise<'confirmed' | 'unknown'> {
  const guard = session.capture(), scope = { ...intent.scope }, operationId = intent.operationId
  const current = () => { check(!guard.signal.aborted); client.assertCurrent() }
  try {
    current(); if (client.chainId !== scope.chainId || scope.realm !== client.realm) return 'unknown'
    const stored = await intents.get(scope, operationId); current()
    if (!stored || !validPrivateVerification(stored.verification)) return 'unknown'
    if (stored.phase === 'confirmed') return 'confirmed'
    if (!['prepared', 'submitted', 'unknown'].includes(stored.phase)) return 'unknown'
    const note = await client.note(scope.noteId); current()
    const evidence = await privateIntentEvidence(client, stored, note, guard.signal); current()
    if (!evidence) return 'unknown'
    const result = await intents.confirm(scope, operationId, evidence, guard); current()
    return result.status === 'saved' ? 'confirmed' : 'unknown'
  } catch { return 'unknown' }
}
