import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted } from '../../grc20'
import type { SignRequest } from '../../../os/sign/signer'
import { QuoteExpiredError } from '../../../os/sign/expired'
import type { DraftSession, NotesWriteResult } from '../drafts'
import { validPrivateCommentVerification } from '../intents'
import type { PrivateCommentIntentVerification, NotesIntent, NotesIntentInput, NotesIntents, NotesOperationEvidence } from '../intents'
import { privateNotesDeployment } from '../config'
import type { NotesIdentityController } from '../identity/controller'
import { openPrivateComments } from '../private/comments'
import { parseEpochPage, parseReaders, parseWriters } from '../private/schema'
import type { NotesReadClient } from './client'
import { commentIntentRealm } from './commentRequest'
import { privateCommentMessage, type PrivateCommentOperation } from './privateCommentMessages'
import { readPrivateComment, type PrivateComment } from './privateComments'
import { gnotAmount } from './quote'
import { notesRequestDigest, validateNotesQuote, type NotesQuoteProvider } from './request'
import { decimal, NotesChainError } from './schema'

export interface PrivateCommentRequestOptions {
  client: NotesReadClient; operation: PrivateCommentOperation; maxDepositUgnot: string; session: DraftSession
  intents: NotesIntents; quote: NotesQuoteProvider; isWriteEnabled(): boolean
  /** Required to post (the review opens the ciphertext again, under the unlocked key, to show it). Delete, Hide and Resolve need no key. */
  access?: { owner: string; identity: NotesIdentityController; signal: AbortSignal }
}
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes))
const short = (value: string) => value.length > 12 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value
const saved = <T,>(value: NotesWriteResult<T>): T => { if (value.status !== 'saved') throw new NotesChainError('storage'); return value.value }
function descriptor(op: PrivateCommentOperation, base: PrivateComment | null, height: string): PrivateCommentIntentVerification {
  const a = op.action, add = a.kind === 'add', deleted = a.kind === 'delete' || !!base?.deleted
  return { kind: 'private-comment-v1', noteId: op.noteId, parent: add ? a.parent ?? '' : base!.parent, author: add ? op.caller : base!.author,
    bodyRevision: add ? a.bodyRevision : base!.bodyRevision, epoch: add ? a.epoch : base!.epoch,
    ciphertextSha256: hash(deleted ? new Uint8Array() : add ? a.ciphertext : base!.ciphertext),
    deleted, hidden: a.kind === 'hide' ? a.hidden : base?.hidden ?? false, resolved: a.kind === 'resolve' ? a.resolved : base?.resolved ?? false, quoteHeight: height }
}
/** Receipts hold ciphertext hashes and public metadata only, never a plaintext fingerprint. */
export function privateCommentEvidence(realm: string, input: NotesIntentInput, comment: PrivateComment | null): NotesOperationEvidence | null {
  const v = input.verification
  if (!validPrivateCommentVerification(v) || !comment || input.scope.realm !== commentIntentRealm(realm, v.noteId)
    || comment.id !== input.scope.noteId || comment.operationId !== input.operationId || comment.actor !== input.actor
    || comment.revision !== input.resultingStateRevision || BigInt(comment.height) <= BigInt(v.quoteHeight)
    || comment.author !== v.author || comment.parent !== v.parent || comment.bodyRevision !== v.bodyRevision || comment.epoch !== v.epoch
    || comment.deleted !== v.deleted || comment.hidden !== v.hidden || comment.resolved !== v.resolved || hash(comment.ciphertext) !== v.ciphertextSha256) return null
  return { scope: { ...input.scope }, operationId: comment.operationId, actor: comment.actor, stateRevision: comment.revision, height: comment.height, outcome: 'applied' }
}
/**
 * One action on a private note's encrypted comment, on this deployment's realm: post (a reader of a Shared note, under its
 * current, unrevealed epoch), delete (the author, whatever the note's state, no key needed), resolve (owner or writer) or
 * hide (owner). The private-notes gate is checked at the start, after every await and before the wallet opens.
 */
export async function preparePrivateCommentRequest(options: PrivateCommentRequestOptions): Promise<SignRequest> {
  const original = options.operation, op: PrivateCommentOperation = { ...original, action: original.action.kind === 'add' ? { ...original.action, ciphertext: original.action.ciphertext.slice() } : { ...original.action } }
  const { client, intents, access } = options, guard = options.session.capture(), generation = access?.identity.getSnapshot().generation
  let closed = false, preview: [string, string][] = []
  const clean = () => { closed = true; preview = []; access?.signal.removeEventListener('abort', clean); guard.signal.removeEventListener('abort', clean) }
  access?.signal.addEventListener('abort', clean); guard.signal.addEventListener('abort', clean)
  const allowed = () => {
    if (closed || guard.signal.aborted || access?.signal.aborted) throw new NotesChainError('session')
    if (access && (access.identity.getSnapshot().phase !== 'unlocked' || access.identity.getSnapshot().generation !== generation)) throw new NotesChainError('session')
    client.assertCurrent()
    if (privateNotesDeployment(client.chainId)?.realm !== client.realm || !options.isWriteEnabled()) throw new NotesChainError('disabled')
  }
  try {
    allowed(); const cap = decimal(options.maxDepositUgnot, 63), message = privateCommentMessage(op, cap, client.realm), a0 = op.action
    if (a0.kind === 'add') {
      if (!access || access.owner !== op.caller) throw new NotesChainError('session')
      // What the sheet shows is what this exact ciphertext opens to, for this note, epoch, id, author, parent and body revision.
      const opened = (await openPrivateComments(client, op.noteId, [{ id: op.commentId, author: op.caller, parent: a0.parent ?? '', bodyRevision: a0.bodyRevision, epoch: a0.epoch,
        ciphertext: a0.ciphertext, deleted: false, hidden: false } as PrivateComment], access)).get(op.commentId); allowed()
      if (opened?.status !== 'open') throw new NotesChainError('format')
      preview = [['Comment (encrypted)', opened.body], ...opened.quote ? [['Quote (encrypted)', opened.quote] as [string, string]] : []]
    }
    const read = async () => {
      const a = op.action
      const [note, comment, config, parent] = await Promise.all([client.noteMetadata(op.noteId), readPrivateComment(client, op.noteId, op.commentId), client.config(),
        a.kind === 'add' && a.parent ? readPrivateComment(client, op.noteId, a.parent) : null])
      allowed()
      if (!note || note.mode > 2 || (note.deleted && a.kind !== 'delete')) throw new NotesChainError('stale')
      if (a.kind === 'add') {
        if (comment || note.mode !== 1 || config.paused || note.epoch !== a.epoch || BigInt(a.bodyRevision) > BigInt(note.bodyRevision) || (a.parent && (!parent || parent.deleted))) throw new NotesChainError('stale')
        // The realm takes a Shared note's comments from its readers (owner and writers included), under an unrevealed epoch.
        const [readers, epoch] = await Promise.all([client.readersRaw(op.noteId), client.epochMetadataRaw(op.noteId, a.epoch)]); allowed()
        if (!parseReaders(readers).includes(op.caller) || parseEpochPage(epoch, a.epoch).revealedKey.length) throw new NotesChainError('stale')
      } else {
        if (!comment || comment.revision !== a.revision || (a.kind === 'delete' && (comment.deleted || comment.author !== op.caller))) throw new NotesChainError('stale')
        if (a.kind === 'hide' && note.owner !== op.caller) throw new NotesChainError('stale')
        if (a.kind === 'resolve' && note.owner !== op.caller) {
          const writers = await client.writersRaw(op.noteId); allowed()
          if (!parseWriters(writers).includes(op.caller)) throw new NotesChainError('stale')
        }
      }
      return { note, comment }
    }
    const base = await read(), height = decimal(await client.height(), 63, true); allowed()
    const parentId = op.action.kind === 'add' ? op.action.parent : base.comment?.parent
    const parent = parentId ? await readPrivateComment(client, op.noteId, parentId).catch(() => null) : null; allowed()
    const digest = notesRequestDigest(client.chainId, message), quoteInput = { chainId: client.chainId, message: structuredClone(message), requestDigest: digest, height }
    const quote = structuredClone(await options.quote(quoteInput)); allowed(); validateNotesQuote(quote, quoteInput, cap)
    const revision = op.action.kind === 'add' ? '0' : op.action.revision
    const input: NotesIntentInput = { scope: { chainId: client.chainId, realm: commentIntentRealm(client.realm, op.noteId), owner: op.caller, noteId: op.commentId },
      operationId: op.operationId, requestDigest: digest, actor: op.caller, action: `${op.action.kind}PrivateComment`, expectedStateRevision: revision,
      resultingStateRevision: decimal((BigInt(revision) + 1n).toString(), 64, true), expectedEpoch: base.comment?.epoch ?? base.note.epoch,
      ownerGeneration: base.note.ownerGeneration, draftLocalRevision: '0', verification: descriptor(op, base.comment, height) }
    let started = false, begun = false, walletMayHaveOpened = false
    const recheck = async () => {
      allowed(); const [now, h] = await Promise.all([read(), client.height()]); allowed()
      if (op.action.kind !== 'delete' && (now.note.epoch !== base.note.epoch || now.note.ownerGeneration !== base.note.ownerGeneration || now.note.mode !== base.note.mode)) throw new NotesChainError('stale')
      if (BigInt(h) < BigInt(height)) throw new NotesChainError('stale')
      if (Date.now() >= quote.expiresAtMs || BigInt(h) > BigInt(quote.expiresAtHeight)) throw new QuoteExpiredError()
      await assertFeeStillCovers(quote.networkFeeUgnot, () => freshFeeForGasWanted(quote.gasWanted)); allowed()
    }
    const a = op.action, label = a.kind === 'add' ? 'Post encrypted comment' : a.kind === 'delete' ? 'Delete encrypted comment'
      : a.kind === 'resolve' ? (a.resolved ? 'Resolve encrypted comment' : 'Reopen encrypted comment') : (a.hidden ? 'Hide encrypted comment' : 'Unhide encrypted comment')
    const targetState: [string, string][] = a.kind === 'resolve' ? [['Thread after confirmation', a.resolved ? 'Resolved' : 'Open']]
      : a.kind === 'hide' ? [['Visibility after confirmation', a.hidden ? 'Hidden' : 'Visible']] : []
    return {
      title: label, summary: label, label: () => label,
      lines: () => [['Note', 'Private note'], ...preview,
        ...a.kind === 'add' ? [['On', a.bodyRevision === base.note.bodyRevision ? `The current text (revision ${base.note.stateRevision})` : 'An earlier text of the note']] as [string, string][]
          : base.comment ? [['Comment by', short(base.comment.author)]] as [string, string][] : [],
        ...parentId ? [['Reply to', parent ? `A comment by ${short(parent.author)}` : 'a comment that is no longer available']] as [string, string][] : [],
        ...targetState,
        ...a.kind === 'delete' ? [['Storage deposit', 'Part of the comment’s deposit is returned to you (about 0.6 GNOT for a comment of maximum length, less for a short one); a record that it existed stays.']] as [string, string][]
          : [[quote.source === 'simulation' ? 'Simulated storage deposit' : 'Expected storage deposit', gnotAmount(quote.estimatedDepositUgnot)]] as [string, string][],
        ['Maximum storage deposit', gnotAmount(cap)], ['Network fee, at most', gnotAmount(quote.networkFeeUgnot)]],
      technical: () => [['Account', op.caller], ['Note ID', op.noteId], ['Comment ID', op.commentId], ['Operation', op.operationId]],
      warns: a.kind === 'add' ? ['The comment and its quote are encrypted in this browser, with the note’s current key: the people it is shared with can read them, and so can anyone given this key later (a reader added before the key next changes). The network shows your address as the author, when you posted and the encrypted size.']
        : a.kind === 'delete' ? ['Deleting removes the encrypted text from the note’s storage. It stays in chain history, readable by whoever holds that version’s key.'] : [],
      ...a.kind === 'add' ? { note: 'One comment per account per note every 10 blocks.' } : {},
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
        if (guard.signal.aborted) throw new NotesChainError('session')
        client.assertCurrent(); const comment = await readPrivateComment(client, op.noteId, op.commentId); client.assertCurrent()
        const evidence = privateCommentEvidence(client.realm, input, comment); if (!evidence) return false
        if (txHash) evidence.txHash = txHash
        saved(await intents.confirm(input.scope, input.operationId, evidence, guard)); return true
      },
      onDismissed: clean,
      onSettled: outcome => { if (begun && outcome === 'unknown') void intents.settle(input.scope, input.operationId, 'unknown', guard).catch(() => {}); clean() },
      pendingNote: () => 'Waiting for this exact encrypted comment operation and revision on chain. Its receipt (hashes only) is retained.',
    }
  } catch (error) { clean(); throw error }
}
/** Explicit Check outcome, with no key or plaintext; never resubmits, and absence stays unknown. */
export async function recoverPrivateCommentIntent(client: Pick<NotesReadClient, 'chainId' | 'realm' | 'assertCurrent' | 'getCommentRaw'>, intents: NotesIntents, intent: NotesIntent, session: DraftSession): Promise<'confirmed' | 'unknown'> {
  const guard = session.capture(), scope = { ...intent.scope }, operationId = intent.operationId
  const current = () => { if (guard.signal.aborted) throw new NotesChainError('session'); client.assertCurrent() }
  try {
    current(); if (client.chainId !== scope.chainId) return 'unknown'
    const stored = await intents.get(scope, operationId); current()
    if (!stored || !validPrivateCommentVerification(stored.verification) || scope.realm !== commentIntentRealm(client.realm, stored.verification.noteId)) return 'unknown'
    if (stored.phase === 'confirmed') return 'confirmed'
    if (!['prepared', 'submitted', 'unknown'].includes(stored.phase)) return 'unknown'
    const comment = await readPrivateComment(client, stored.verification.noteId, scope.noteId); current()
    const evidence = privateCommentEvidence(client.realm, stored, comment); if (!evidence) return 'unknown'
    const result = await intents.confirm(scope, operationId, evidence, guard); current()
    return result.status === 'saved' ? 'confirmed' : 'unknown'
  } catch { return 'unknown' }
}
