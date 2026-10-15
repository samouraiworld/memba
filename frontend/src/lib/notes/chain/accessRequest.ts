import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted } from '../../grc20'
import type { SignRequest } from '../../../os/sign/signer'
import type { DraftSession, NotesWriteResult } from '../drafts'
import { validAccessVerification } from '../intents'
import type { AccessIntentVerification, NotesIntent, NotesIntents, NotesIntentInput, NotesOperationEvidence } from '../intents'
import { privateNotesDeployment } from '../config'
import type { NotesReadClient } from './client'
import { address, check, decimal, NotesChainError } from './schema'
import type { ChainNote } from './schema'
import { accessMessage } from './accessMessages'
import type { AccessOperation } from './accessMessages'
import { gnotAmount } from './quote'
import { notesRequestDigest, validateNotesQuote } from './request'
import type { NotesQuoteProvider } from './request'

// Ported from the reviewed 10-09 accessRequest.ts (2399ebef): Delete of a private note by its owner, on the deployment's
// realm, behind the private-notes gate (start, after every await, before the wallet and in its final guard).
export interface AccessState { note: ChainNote; writers: string[] }
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes))
const jsonHash = (value: unknown) => hash(new TextEncoder().encode(JSON.stringify(value)))
const writersHash = (writers: string[]) => jsonHash([...writers].sort())
function metadataHash(n: ChainNote): string {
  return jsonHash([n.id, n.owner, n.pendingOwner, n.ownerGeneration, n.mode, n.stateRevision, n.titleRevision, n.bodyRevision,
    n.epoch, hash(n.title), n.bodyBytes, hash(n.commitment), n.deleted, n.listed, n.createdHeight, n.govWriters, n.ownerListed, n.moderatorHidden])
}
/** Read one coherent metadata/ACL snapshot. Ciphertext content is not downloaded. */
export async function readAccessState(client: NotesReadClient, noteId: string, signal: AbortSignal, allowDeleted = false): Promise<AccessState> {
  const current = () => { client.assertCurrent(); if (signal.aborted) throw new NotesChainError('session') }
  current(); const note = await client.noteMetadata(noteId); current(); check(note && (allowDeleted || !note.deleted))
  const raw = await client.writersRaw(noteId); current(); check(Array.isArray(raw) && raw.length <= 32)
  const writers = raw.map(who => address(who)); check(new Set(writers).size === writers.length)
  const final = await client.noteMetadata(noteId); current()
  if (!final || metadataHash(final) !== metadataHash(note)) throw new NotesChainError('stale')
  return { note, writers }
}
function permitted(op: AccessOperation, state: AccessState): void {
  const n = state.note
  if (n.id !== op.noteId || n.deleted || n.mode > 2 || n.stateRevision !== op.revision || n.ownerGeneration !== op.ownerGeneration) throw new NotesChainError('stale')
  check(BigInt(n.stateRevision) < 0xffffffffffffffffn && n.owner === op.caller && op.action.kind === 'delete')
}
/** The note as the realm leaves it after Delete (notes.gno mutateDelete): no title, body, commitment or writers. */
export function accessVerification(op: AccessOperation, before: AccessState, quoteHeight: string): AccessIntentVerification {
  permitted(op, before)
  const n: ChainNote = { ...before.note, stateRevision: (BigInt(before.note.stateRevision) + 1n).toString(), deleted: true, listed: false, ownerListed: false,
    title: new Uint8Array(), bodyBytes: 0, commitment: new Uint8Array(), pendingOwner: '', govWriters: false }
  const v: AccessIntentVerification = { kind: 'access-v1', metadataSha256: metadataHash(n), writersSha256: writersHash([]), quoteHeight }
  check(validAccessVerification(v)); return v
}
export function accessIntentEvidence(input: NotesIntentInput, expected: AccessIntentVerification, after: AccessState): NotesOperationEvidence | null {
  const n = after.note
  if (!validAccessVerification(expected) || n.id !== input.scope.noteId || n.deleted !== (input.action === 'access-delete')
    || n.operationId !== input.operationId || n.actor !== input.actor || n.stateRevision !== input.resultingStateRevision
    || BigInt(n.height) <= BigInt(expected.quoteHeight) || metadataHash(n) !== expected.metadataSha256 || writersHash(after.writers) !== expected.writersSha256) return null
  return { scope: { ...input.scope }, operationId: n.operationId, actor: n.actor, stateRevision: n.stateRevision, height: n.height, outcome: 'applied' }
}
export interface AccessRequestOptions {
  client: NotesReadClient; operation: AccessOperation; maxDepositUgnot: string; session: DraftSession; intents: NotesIntents
  quote: NotesQuoteProvider; isWriteEnabled(): boolean
  /** The local revision of this device's encrypted draft of the note, as read by the Delete sheet ('0' for none): a later
   * "Check outcome" removes exactly that revision (compare-and-swap), never a draft changed after it was read. */
  draftLocalRevision?: string
}
const saved = <T,>(value: NotesWriteResult<T>): T => { if (value.status !== 'saved') throw new NotesChainError('storage'); return value.value }
/** Persist the exact expected metadata and ACL before opening the wallet. */
export async function prepareAccessRequest(options: AccessRequestOptions): Promise<SignRequest> {
  const { client, intents } = options, guard = options.session.capture(), op = structuredClone(options.operation)
  let dismissed = false
  const current = () => { if (guard.signal.aborted || dismissed) throw new NotesChainError('session'); client.assertCurrent() }
  const allowed = () => {
    current(); if (privateNotesDeployment(client.chainId)?.realm !== client.realm || !options.isWriteEnabled()) throw new NotesChainError('disabled')
  }
  allowed(); const cap = decimal(options.maxDepositUgnot, 63), message = accessMessage(op, client.realm, cap)
  const draftLocalRevision = decimal(options.draftLocalRevision ?? '0')
  const read = () => readAccessState(client, op.noteId, guard.signal)
  const base = await read(); allowed(); permitted(op, base)
  const height = await client.height(); allowed()
  const digest = notesRequestDigest(client.chainId, message), expected = accessVerification(op, base, height)
  const quote = structuredClone(await options.quote({ chainId: client.chainId, message: structuredClone(message), requestDigest: digest, height })); allowed()
  validateNotesQuote(quote, { chainId: client.chainId, requestDigest: digest, height }, cap)
  const input: NotesIntentInput = { scope: { chainId: client.chainId, realm: client.realm, owner: op.caller, noteId: op.noteId }, operationId: op.operationId,
    actor: op.caller, action: `access-${op.action.kind}`, requestDigest: digest, expectedStateRevision: op.revision,
    resultingStateRevision: (BigInt(op.revision) + 1n).toString(), expectedEpoch: base.note.epoch, ownerGeneration: op.ownerGeneration, draftLocalRevision, verification: expected }
  let started = false, begun = false, walletMayHaveOpened = false
  const recheck = async () => {
    allowed(); const next = await read(); allowed(); permitted(op, next)
    if (metadataHash(next.note) !== metadataHash(base.note) || writersHash(next.writers) !== writersHash(base.writers)) throw new NotesChainError('stale')
    const h = await client.height(); allowed()
    if (Date.now() >= quote.expiresAtMs || BigInt(h) < BigInt(height) || BigInt(h) > BigInt(quote.expiresAtHeight)) throw new NotesChainError('stale')
    await assertFeeStillCovers(quote.networkFeeUgnot, () => freshFeeForGasWanted(quote.gasWanted)); allowed()
  }
  return {
    title: 'Delete private note', summary: 'Delete your private note', label: () => 'Delete private note',
    lines: () => [['Account', op.caller], ['Network', client.chainId], ['Realm', client.realm], ['Note', op.noteId], ['Operation', op.operationId],
      ['Revision', `${op.revision} → ${input.resultingStateRevision}`], ['Storage deposit', 'None taken: deleting returns about half of what this note locked'],
      ['Maximum storage deposit', gnotAmount(cap)], ['Network fee, at most', gnotAmount(quote.networkFeeUgnot)]],
    warns: ['Delete returns about half of what this note locked; the rest stays locked.',
      'Deletion cannot erase chain history: earlier encrypted versions stay on the network, and anyone the note was shared with keeps what they already read.'],
    prepare: () => { allowed(); return { msgs: [structuredClone(message)] } }, recheck,
    send: async (_choice, beforeSign) => {
      allowed(); if (started) throw new NotesChainError('stale'); started = true
      saved(await intents.begin(input, guard)); begun = true
      try {
        allowed()
        const result = await doContractBroadcast([structuredClone(message)], '', { gasWanted: quote.gasWanted, gasFee: quote.networkFeeUgnot,
          beforeSign: async () => { await recheck(); const finalGuard = await beforeSign(); allowed(); if (finalGuard && !finalGuard()) throw new NotesChainError('session')
            walletMayHaveOpened = true; return () => { try { allowed(); return Date.now() < quote.expiresAtMs && (!finalGuard || finalGuard()) } catch { return false } } },
        })
        saved(await intents.settle(input.scope, input.operationId, 'submitted', guard, result.hash)); return result
      } catch (error) { await intents.settle(input.scope, input.operationId, walletMayHaveOpened ? 'unknown' : 'not-sent', guard); throw error }
    },
    verify: async (_choice, txHash) => {
      client.assertCurrent(); check(!guard.signal.aborted)
      const after = await readAccessState(client, op.noteId, guard.signal, true); client.assertCurrent()
      const evidence = accessIntentEvidence(input, expected, after); if (!evidence) return false
      if (txHash) evidence.txHash = txHash
      saved(await intents.confirm(input.scope, input.operationId, evidence, guard)); return true
    },
    onSettled: outcome => { if (begun && outcome === 'unknown') void intents.settle(input.scope, input.operationId, 'unknown', guard).catch(() => {}) },
    onDismissed: () => { dismissed = true }, pendingNote: () => 'Waiting for the exact note revision and its deletion. No operation is retried.',
  }
}

/** Check an unknown result without keys, wallet access, retries or draft deletion. */
export async function recoverAccessIntent(client: NotesReadClient, intents: NotesIntents, intent: NotesIntent, session: DraftSession): Promise<'confirmed' | 'unknown'> {
  const guard = session.capture(), scope = { ...intent.scope }, operationId = intent.operationId
  const current = () => { client.assertCurrent(); if (guard.signal.aborted) throw new NotesChainError('session') }
  try {
    current(); if (client.chainId !== scope.chainId || scope.realm !== client.realm) return 'unknown'
    const stored = await intents.get(scope, operationId); current()
    if (!stored || !validAccessVerification(stored.verification)) return 'unknown'
    if (stored.phase === 'confirmed') return 'confirmed'
    if (!['prepared', 'submitted', 'unknown'].includes(stored.phase)) return 'unknown'
    const state = await readAccessState(client, scope.noteId, guard.signal, true); current()
    const evidence = accessIntentEvidence(stored, stored.verification, state)
    if (!evidence) return 'unknown'
    const result = await intents.confirm(scope, operationId, evidence, guard); current()
    return result.status === 'saved' ? 'confirmed' : 'unknown'
  } catch { return 'unknown' }
}
