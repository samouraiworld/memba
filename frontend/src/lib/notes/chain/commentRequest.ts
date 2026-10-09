import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, MAX_GAS_WANTED } from '../../grc20'
import type { SignRequest } from '../../../os/sign/signer'
import type { DraftSession, NotesWriteResult } from '../drafts'
import { validCommentVerification } from '../intents'
import type { CommentIntentVerification, NotesIntent, NotesIntentInput, NotesIntents, NotesOperationEvidence } from '../intents'
import type { NotesReadClient } from './client'
import { publicCommentMessage, type CommentOperation } from './commentMessages'
import { readPublicComment, type PublicComment } from './comments'
import { notesRequestDigest, type NotesQuote, type NotesQuoteProvider } from './request'
import { check, decimal, NOTES_REALM, NotesChainError, type ChainNote } from './schema'
import { readPublicWritePermission } from './publicPermissions'

type Client = Pick<NotesReadClient, 'chainId' | 'assertCurrent' | 'note' | 'noteMetadata' | 'writersRaw' | 'config' | 'height' | 'getCommentRaw'>
export interface CommentRequestOptions {
  client: Client; operation: CommentOperation; maxDepositUgnot: string; session: DraftSession
  intents: NotesIntents; quote: NotesQuoteProvider; isWriteEnabled(): boolean
}
const hash = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)))
const saved = <T,>(value: NotesWriteResult<T>): T => { if (value.status !== 'saved') throw new NotesChainError('storage'); return value.value }
export const commentIntentRealm = (noteId: string) => `${NOTES_REALM}/comments/${noteId}`
function verifyBase(op: CommentOperation, note: ChainNote | null, comment: PublicComment | null): void {
  const a = op.action
  if (!note || note.mode < 3 || (note.deleted && a.kind !== 'delete')) throw new NotesChainError('stale')
  if (a.kind === 'add') {
    if (comment || note.epoch !== a.epoch || BigInt(a.bodyRevision) > BigInt(note.bodyRevision)) throw new NotesChainError('stale')
  } else if (!comment || comment.encrypted || comment.revision !== a.revision
    || (a.kind === 'delete' ? comment.deleted || comment.author !== op.caller : a.kind === 'hide' && note.owner !== op.caller)) throw new NotesChainError('stale')
}
function descriptor(op: CommentOperation, base: PublicComment | null, height: string): CommentIntentVerification {
  const a = op.action, add = a.kind === 'add', deleted = a.kind === 'delete' || !!base?.deleted
  return { kind: 'comment-v1', noteId: op.noteId, parent: add ? a.parent ?? '' : base!.parent, author: add ? op.caller : base!.author,
    bodyRevision: add ? a.bodyRevision : base!.bodyRevision, epoch: add ? a.epoch : base!.epoch,
    anchorSha256: hash(deleted ? '' : add ? a.anchor : base!.anchor), bodySha256: hash(deleted ? '' : add ? a.body : base!.body),
    deleted, hidden: a.kind === 'hide' ? a.hidden : base?.hidden ?? false, resolved: a.kind === 'resolve' ? a.resolved : base?.resolved ?? false, quoteHeight: height }
}
export function publicCommentEvidence(input: NotesIntentInput, comment: PublicComment | null): NotesOperationEvidence | null {
  const v = input.verification
  if (!validCommentVerification(v) || !comment || comment.encrypted || input.scope.realm !== commentIntentRealm(v.noteId)
    || comment.id !== input.scope.noteId || comment.operationId !== input.operationId || comment.actor !== input.actor
    || comment.revision !== input.resultingStateRevision || BigInt(comment.height) <= BigInt(v.quoteHeight)
    || comment.author !== v.author || comment.parent !== v.parent || comment.bodyRevision !== v.bodyRevision || comment.epoch !== v.epoch
    || comment.deleted !== v.deleted || comment.hidden !== v.hidden || comment.resolved !== v.resolved
    || hash(comment.body) !== v.bodySha256 || hash(comment.anchor) !== v.anchorSha256) return null
  return { scope: { ...input.scope }, operationId: comment.operationId, actor: comment.actor, stateRevision: comment.revision, height: comment.height, outcome: 'applied' }
}
function validateQuote(q: NotesQuote, chainId: string, digest: string, height: string, cap: string): void {
  check(q.chainId === chainId && q.requestDigest === digest && q.maxDepositUgnot === cap && q.atHeight === height)
  const expiry = BigInt(decimal(q.expiresAtHeight, 63, true))
  check(expiry >= BigInt(height) && expiry <= BigInt(height) + 20n && Number.isSafeInteger(q.expiresAtMs) && q.expiresAtMs > Date.now() && q.expiresAtMs <= Date.now() + 120000)
  check(q.source === 'simulation' || q.source === 'bounded-estimate')
  check(BigInt(decimal(q.estimatedDepositUgnot, 63)) <= BigInt(cap) && Number.isSafeInteger(q.gasWanted) && q.gasWanted > 0 && q.gasWanted <= MAX_GAS_WANTED
    && Number.isSafeInteger(q.networkFeeUgnot) && q.networkFeeUgnot > 0)
}
export async function preparePublicCommentRequest(options: CommentRequestOptions): Promise<SignRequest> {
  const op = structuredClone(options.operation), { client, intents } = options, guard = options.session.capture()
  const allowed = () => { if (guard.signal.aborted) throw new NotesChainError('session'); client.assertCurrent(); if (!options.isWriteEnabled()) throw new NotesChainError('disabled') }
  allowed(); const cap = decimal(options.maxDepositUgnot, 63), message = publicCommentMessage(op, cap)
  const read = async () => {
    const [note, comment, config, parent] = await Promise.all([client.note(op.noteId), readPublicComment(client, op.noteId, op.commentId), client.config(),
      op.action.kind === 'add' && op.action.parent ? readPublicComment(client, op.noteId, op.action.parent) : null])
    allowed(); verifyBase(op, note, comment)
    if ((op.action.kind === 'resolve' || (op.action.kind === 'add' && note!.mode === 3))
      && !await readPublicWritePermission(client, note!, op.caller)) throw new NotesChainError('stale')
    allowed()
    if (op.action.kind === 'add' && (config.paused || (op.action.parent && (!parent || parent.deleted)))) throw new NotesChainError('stale')
    return { note: note!, comment }
  }
  const base = await read(), height = decimal(await client.height(), 63, true); allowed()
  const digest = notesRequestDigest(client.chainId, message)
  const quote = structuredClone(await options.quote({ chainId: client.chainId, message: structuredClone(message), requestDigest: digest, height })); allowed()
  validateQuote(quote, client.chainId, digest, height, cap)
  const revision = op.action.kind === 'add' ? '0' : op.action.revision
  const input: NotesIntentInput = { scope: { chainId: client.chainId, realm: commentIntentRealm(op.noteId), owner: op.caller, noteId: op.commentId },
    operationId: op.operationId, requestDigest: digest, actor: op.caller, action: `${op.action.kind}Comment`, expectedStateRevision: revision,
    resultingStateRevision: decimal((BigInt(revision) + 1n).toString(), 64, true), expectedEpoch: base.comment?.epoch ?? base.note.epoch,
    ownerGeneration: base.note.ownerGeneration, draftLocalRevision: '0', verification: descriptor(op, base.comment, height) }
  let started = false, begun = false, walletMayHaveOpened = false
  const recheck = async () => {
    allowed(); const [now, h] = await Promise.all([read(), client.height()]); allowed()
    if (op.action.kind !== 'delete' && (now.note.stateRevision !== base.note.stateRevision || now.note.ownerGeneration !== base.note.ownerGeneration)) throw new NotesChainError('stale')
    if (Date.now() >= quote.expiresAtMs || BigInt(h) > BigInt(quote.expiresAtHeight) || BigInt(h) < BigInt(height)) throw new NotesChainError('stale')
    await assertFeeStillCovers(quote.networkFeeUgnot, () => freshFeeForGasWanted(quote.gasWanted)); allowed()
  }
  const label = op.action.kind === 'add' ? 'Post public comment' : op.action.kind === 'delete' ? 'Delete comment'
    : op.action.kind === 'resolve' ? (op.action.resolved ? 'Resolve comment' : 'Reopen comment') : (op.action.hidden ? 'Hide comment' : 'Unhide comment')
  const targetState: [string, string][] = op.action.kind === 'resolve' ? [['Thread after confirmation', op.action.resolved ? 'Resolved' : 'Open']]
    : op.action.kind === 'hide' ? [['Visibility after confirmation', op.action.hidden ? 'Hidden' : 'Visible']] : []
  return {
    title: label, summary: label, label: () => label,
    lines: () => [['Account', op.caller], ['Network', client.chainId], ['Note', op.noteId], ['Comment', op.commentId], ['Operation', op.operationId], ...targetState,
      [quote.source === 'simulation' ? 'Simulated deposit (ugnot)' : 'Estimated deposit (ugnot)', quote.estimatedDepositUgnot], ['Maximum deposit (ugnot)', cap], ['Network fee (ugnot)', String(quote.networkFeeUgnot)],
      ...(op.action.kind === 'add' ? [['Body revision', op.action.bodyRevision], ['Quoted passage', op.action.anchor || '(none)'], ['Comment text', op.action.body]] as [string, string][] : [])],
    warns: ['Public comments and earlier versions remain in chain history.'],
    ...(op.action.kind === 'add' ? { acks: ['I have reviewed the comment and its quoted passage.', 'I understand this comment is public and remains in chain history.'], note: 'The quoted passage belongs to its recorded body revision. One comment per account per note every 10 blocks.' } : {}),
    prepare: () => ({ msgs: [structuredClone(message)] }), recheck,
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
      allowed(); const comment = await readPublicComment(client, op.noteId, op.commentId); allowed()
      const evidence = publicCommentEvidence(input, comment); if (!evidence) return false
      if (txHash) evidence.txHash = txHash
      saved(await intents.confirm(input.scope, input.operationId, evidence, guard)); return true
    },
    onSettled: outcome => { if (begun && outcome === 'unknown') void intents.settle(input.scope, input.operationId, 'unknown', guard).catch(() => {}) },
    pendingNote: () => 'Waiting for this exact comment operation and revision on chain. Its receipt is retained.',
  }
}
/** Explicit Check outcome; does not resubmit or infer failure from absence. */
export async function recoverPublicCommentIntent(client: Pick<Client, 'chainId' | 'assertCurrent' | 'getCommentRaw'>, intents: NotesIntents, intent: NotesIntent, session: DraftSession): Promise<'confirmed' | 'unknown'> {
  const guard = session.capture(), scope = { ...intent.scope }, operationId = intent.operationId
  const current = () => { if (guard.signal.aborted) throw new NotesChainError('session'); client.assertCurrent() }
  try {
    current(); if (client.chainId !== scope.chainId) return 'unknown'
    const stored = await intents.get(scope, operationId); current()
    if (!stored || !validCommentVerification(stored.verification) || scope.realm !== commentIntentRealm(stored.verification.noteId)) return 'unknown'
    if (stored.phase === 'confirmed') return 'confirmed'
    if (!['prepared', 'submitted', 'unknown'].includes(stored.phase)) return 'unknown'
    const comment = await readPublicComment(client, stored.verification.noteId, scope.noteId); current()
    const evidence = publicCommentEvidence(stored, comment); if (!evidence) return 'unknown'
    const result = await intents.confirm(scope, operationId, evidence, guard); current()
    return result.status === 'saved' ? 'confirmed' : 'unknown'
  } catch { return 'unknown' }
}
