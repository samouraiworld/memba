import { sha256 } from '@noble/hashes/sha2.js'
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted } from '../../grc20'
import type { AminoMsg } from '../../grc20'
import { bech32Encode } from '../../dao/realmAddress'
import type { SignRequest } from '../../../os/sign/signer'
import type { DraftSession, NotesWriteResult } from '../drafts'
import type { NotesIntentInput, NotesIntents } from '../intents'
import type { NotesReadClient } from '../chain/client'
import type { ChainNote } from '../chain/schema'
import { check, decimal, NotesChainError } from '../chain/schema'
import { notesRequestDigest, validateNotesQuote } from '../chain/request'
import type { NotesQuoteInput, NotesQuoteProvider } from '../chain/request'
import { gnotAmount } from '../chain/quote'
import { equalBytes } from '../crypto/bytes'
import { decodeManifest } from '../crypto/manifest'
import { privateNotesDeployment } from '../config'
import { privateNoteMessage } from './messages'
import { readPrivateAccess } from './reader'
import { parseEpochPage } from './schema'
import type { PrivateNoteOperation, PrivateOperationState } from './messages'
import { privateIntentEvidence, privateVerification } from './recovery'

/** The note revision an edit was reviewed against (null for a create): any change on chain makes the request stale. */
export type PrivateReviewedState = Pick<ChainNote, 'id' | 'stateRevision' | 'epoch' | 'ownerGeneration' | 'titleRevision' | 'bodyRevision' | 'owner' | 'mode'>
export interface PrivateRequestOptions {
  client: NotesReadClient; operation: PrivateNoteOperation; reviewed: PrivateReviewedState | null
  maxDepositUgnot: string; draftLocalRevision: string; session: DraftSession; intents: NotesIntents; quote: NotesQuoteProvider
  /** Central Notes deployment/rollout gate, checked again immediately before wallet access. */
  isWriteEnabled: () => boolean
  /** Captured private-editor/identity lease; lock invalidates an already prepared review. */
  isPrivateSessionCurrent: () => boolean; privateSignal: AbortSignal
  /** Receives the verified note at the resulting revision once this operation is confirmed. */
  onConfirmed?: (note: ChainNote) => void
}
function copy<T>(value: T): T {
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice() as T
  if (Array.isArray(value)) return value.map(copy) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) as T
  return value
}
function saved<T>(value: NotesWriteResult<T>): T { if (value.status !== 'saved') throw new NotesChainError('storage'); return value.value }
function sameBase(note: ChainNote | null, expected: PrivateReviewedState | null): boolean {
  if (!expected) return note === null
  return !!note && !note.deleted && (['id', 'stateRevision', 'epoch', 'ownerGeneration', 'titleRevision', 'bodyRevision', 'owner', 'mode'] as const).every(key => note[key] === expected[key])
}
/**
 * Creates a private note ("only me"), commits an edit to one, or (owner) adds a reader (ApplyAccess) or removes one
 * (Rotate, a new epoch). All signing inputs are immutable snapshots; neither key material nor plaintext
 * enters the message, the quote input or the durable intention (ciphertext and envelopes only). No wallet opens here.
 */
export async function preparePrivateNoteRequest(options: PrivateRequestOptions): Promise<SignRequest> {
  const session = options.session.capture(), { signal } = session, { client, intents, privateSignal } = options
  const operation = copy(options.operation), action = operation.action, reviewed = copy(options.reviewed)
  let dismissed = false
  const cap = decimal(options.maxDepositUgnot, 63)
  // Runs at the start, after every await and in beforeSign: the private-notes gate for this very deployment, and the
  // captured account session and identity lease.
  const current = () => {
    if (dismissed || signal.aborted || privateSignal.aborted || !options.isPrivateSessionCurrent()) throw new NotesChainError('session')
    client.assertCurrent()
    if (privateNotesDeployment(client.chainId)?.realm !== client.realm) throw new NotesChainError('disabled')
  }
  const writable = () => { current(); if (!options.isWriteEnabled()) throw new NotesChainError('disabled') }
  writable(); check(operation.chainId === client.chainId && (action.kind === 'create') === (reviewed === null))
  const draftLocalRevision = decimal(options.draftLocalRevision)
  async function state(): Promise<PrivateOperationState> {
    const [note, config] = await Promise.all([client.note(operation.noteId), client.config()]); current()
    if (!sameBase(note, reviewed) || (action.kind === 'create' && config.paused)) throw new NotesChainError('stale')
    let epoch = null
    if (action.kind !== 'create') {
      // The epoch as reviewed, and the very envelopes the operation was checked against (who may write, who reads).
      epoch = parseEpochPage(await client.epochMetadataRaw(note!.id, note!.epoch), note!.epoch); current()
      if (!equalBytes(await readPrivateAccess(client, note!, signal), action.previousManifest)) throw new NotesChainError('stale')
      current()
      if (action.kind === 'commit') return { note, epoch, config }
    }
    // Every envelope of the new manifest is for the registry key it names: active, same generation, same public key.
    const manifest = action.kind === 'access' ? action.manifest : action.prepared.manifest
    for (const entry of decodeManifest(manifest, action.kind === 'access' ? Number(note!.epoch) : action.prepared.epoch)) {
      const who = bech32Encode('g', entry.address), key = await client.key(who); current()
      if (!key.active || key.address !== who || BigInt(key.generation) !== entry.generation || !equalBytes(sha256(key.publicKey), entry.publicKeyHash)) throw new NotesChainError('stale')
    }
    return { note, epoch, config }
  }
  const base = await state(), message: AminoMsg = privateNoteMessage(operation, client.realm, cap, base)
  const height = await client.height(); current()
  const quoteInput: NotesQuoteInput = { chainId: client.chainId, message, requestDigest: notesRequestDigest(client.chainId, message), height }
  const quote = copy(await options.quote(copy(quoteInput))); current(); validateNotesQuote(quote, quoteInput, cap)
  const revision = base.note?.stateRevision ?? '0'
  const input: NotesIntentInput = {
    scope: { chainId: client.chainId, realm: client.realm, owner: operation.caller, noteId: operation.noteId }, operationId: operation.operationId,
    actor: operation.caller, action: `private-${action.kind}`, requestDigest: quoteInput.requestDigest, expectedStateRevision: revision,
    resultingStateRevision: decimal((BigInt(revision) + 1n).toString(), 64, true), expectedEpoch: base.note?.epoch ?? '0',
    ownerGeneration: base.note?.ownerGeneration ?? '1', draftLocalRevision, verification: privateVerification(operation, base.note, height, cap),
  }
  let begun = false, started = false, walletMayHaveOpened = false
  const recheck = async () => {
    writable(); const next = await state(), nextHeight = await client.height(); writable()
    if (Date.now() >= quote.expiresAtMs || BigInt(nextHeight) > BigInt(quote.expiresAtHeight) || BigInt(nextHeight) < BigInt(height)
      || notesRequestDigest(client.chainId, privateNoteMessage(operation, client.realm, cap, next)) !== quoteInput.requestDigest) throw new NotesChainError('stale')
    await assertFeeStillCovers(quote.networkFeeUgnot, () => freshFeeForGasWanted(quote.gasWanted)); writable()
  }
  const creating = action.kind === 'create', kind = action.kind
  const sealed = action.kind === 'create' || action.kind === 'rotate' ? action.prepared : null
  const manifest = sealed ? sealed.manifest : action.kind === 'access' ? action.manifest : null
  const envelopes = manifest ? decodeManifest(manifest, sealed ? sealed.epoch : Number(base.note!.epoch)) : []
  // The readers this operation adds or removes (none for a create or an edit).
  const after = envelopes.map(entry => bech32Encode('g', entry.address))
  const before = action.kind === 'access' || action.kind === 'rotate' ? decodeManifest(action.previousManifest, Number(base.note!.epoch)).map(entry => bech32Encode('g', entry.address)) : after
  const added = after.filter(who => !before.includes(who)), removed = before.filter(who => !after.includes(who))
  const changed = sealed ?? (action.kind === 'commit' ? action : null)
  const sizes = [changed?.title && `title ${changed.title.length} B`, changed?.body && `body ${changed.body.length} B`, manifest && `envelopes ${manifest.length} B`].filter(Boolean).join(', ')
  const others = (list: string[]) => list.filter(who => who !== operation.caller)
  const readers = (list: string[]) => others(list).length ? `You and ${others(list).join(', ')}` : 'Only you'
  const texts = {
    create: { title: 'Publish private note', summary: 'Publish an encrypted note that only you can read', pending: 'Waiting for this exact operation, its ciphertexts and your envelope on chain. Nothing is sent again.',
      warn: 'The storage deposit stays locked while the note exists: deleting it returns about half; the rest stays locked.', who: `Only you · your key, generation ${envelopes[0]?.generation}` },
    commit: { title: 'Publish private changes', summary: 'Publish encrypted changes to your private note', pending: 'Waiting for this exact operation, revision and ciphertexts on chain. Nothing is sent again.',
      warn: 'Only the growth of the encrypted text is locked as deposit; the note keeps no earlier versions.', who: 'Unchanged by this edit' },
    access: { title: 'Share private note', summary: 'Share your private note with another reader', pending: 'Waiting for this exact operation, revision and envelopes on chain. Nothing is sent again.',
      warn: `${added.join(', ')} can read this note as it is now, and its earlier versions since its key last changed (they stay in chain history). Their address becomes public on the network as a reader of this note.`, who: readers(after) },
    rotate: { title: 'Remove a reader', summary: 'Remove a reader from your private note', pending: 'Waiting for this exact operation, its new key, ciphertexts and envelopes on chain. Nothing is sent again.',
      warn: `${removed.join(', ')} keep what they already read; new versions are hidden from them. The note gets a new key, and its current text is encrypted again for the remaining readers.`, who: readers(after) },
  }[kind]
  const request: SignRequest = {
    title: texts.title, summary: texts.summary, label: () => texts.title,
    warns: ['The text is encrypted in this browser. The network still shows your address as the owner, the note’s sizes and when it changes.', texts.warn],
    lines: () => [['Account', operation.caller], ['Network', client.chainId], ['Realm', client.realm], ['Note', operation.noteId], ['Operation', operation.operationId],
      ...creating ? [] : [['Revision', `${revision} → ${input.resultingStateRevision}`] as [string, string]],
      ...added.length ? [['Adds', added.join(', ')] as [string, string]] : [], ...removed.length ? [['Removes', removed.join(', ')] as [string, string]] : [],
      ['Who can read', texts.who], ['Public on the network', `${manifest && !creating ? 'Owner and reader addresses' : 'Owner address'}, encrypted sizes (${sizes}), times`],
      ['Publication fee', gnotAmount(creating ? base.config!.createFeeUgnot : '0')],
      [quote.source === 'simulation' ? 'Simulated storage deposit' : 'Estimated storage deposit', gnotAmount(quote.estimatedDepositUgnot)],
      ['Maximum storage deposit', gnotAmount(cap)], ['Network fee, at most', gnotAmount(quote.networkFeeUgnot)]],
    prepare: () => { current(); return { msgs: [copy(message)] } }, recheck,
    send: async (_choice, beforeSign) => {
      writable(); if (started) throw new NotesChainError('stale'); started = true
      saved(await intents.begin(input, session)); begun = true
      try {
        writable()
        const result = await doContractBroadcast([copy(message)], '', { gasWanted: quote.gasWanted, gasFee: quote.networkFeeUgnot,
          beforeSign: async () => {
            await recheck(); const guard = await beforeSign(); writable(); if (guard && !guard()) throw new NotesChainError('session')
            walletMayHaveOpened = true
            return () => { try { writable(); return Date.now() < quote.expiresAtMs && (!guard || guard()) } catch { return false } }
          },
        })
        saved(await intents.settle(input.scope, input.operationId, 'submitted', session, result.hash)); return result
      } catch (error) {
        // Even a wallet cancellation cannot prove non-broadcast once the wallet may have opened.
        if (begun) await intents.settle(input.scope, input.operationId, walletMayHaveOpened ? 'unknown' : 'not-sent', session)
        throw error
      }
    },
    verify: async (_choice, hash) => {
      client.assertCurrent(); check(!signal.aborted)
      const note = await client.note(operation.noteId); client.assertCurrent()
      const evidence = await privateIntentEvidence(client, input, note, signal); client.assertCurrent()
      if (!evidence || !note) return false
      if (hash) evidence.txHash = hash
      saved(await intents.confirm(input.scope, input.operationId, evidence, session))
      options.onConfirmed?.(copy(note)); return true
    },
    onSettled: outcome => {
      if (begun && outcome === 'unknown') void intents.settle(input.scope, input.operationId, 'unknown', session).catch(() => {})
    },
    onDismissed: () => { dismissed = true },
    pendingNote: () => texts.pending,
  }
  return request
}
