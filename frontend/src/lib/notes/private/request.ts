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
import type { PrivateNoteOperation, PrivateOperationState } from './messages'
import { privateIntentEvidence, privateVerification } from './recovery'

export interface PrivateRequestOptions {
  client: NotesReadClient; operation: PrivateNoteOperation
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
/**
 * Creates a private note ("only me"). All signing inputs are immutable snapshots; neither key material nor plaintext
 * enters the message, the quote input or the durable intention (ciphertext and envelopes only). No wallet opens here.
 */
export async function preparePrivateNoteRequest(options: PrivateRequestOptions): Promise<SignRequest> {
  const session = options.session.capture(), { signal } = session, { client, intents, privateSignal } = options
  const operation = copy(options.operation), action = operation.action
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
  writable(); check(operation.chainId === client.chainId && action.kind === 'create')
  const draftLocalRevision = decimal(options.draftLocalRevision)
  async function state(): Promise<PrivateOperationState> {
    const [note, config] = await Promise.all([client.note(operation.noteId), client.config()]); current()
    if (note !== null || config.paused) throw new NotesChainError('stale')
    // Every envelope is for the registry key it names: active, same generation, same public key.
    for (const entry of decodeManifest(action.prepared.manifest, action.prepared.epoch)) {
      const who = bech32Encode('g', entry.address), key = await client.key(who); current()
      if (!key.active || key.address !== who || BigInt(key.generation) !== entry.generation || !equalBytes(sha256(key.publicKey), entry.publicKeyHash)) throw new NotesChainError('stale')
    }
    return { note: null, epoch: null, config }
  }
  const base = await state(), message: AminoMsg = privateNoteMessage(operation, client.realm, cap, base)
  const height = await client.height(); current()
  const quoteInput: NotesQuoteInput = { chainId: client.chainId, message, requestDigest: notesRequestDigest(client.chainId, message), height }
  const quote = copy(await options.quote(copy(quoteInput))); current(); validateNotesQuote(quote, quoteInput, cap)
  const input: NotesIntentInput = {
    scope: { chainId: client.chainId, realm: client.realm, owner: operation.caller, noteId: operation.noteId }, operationId: operation.operationId,
    actor: operation.caller, action: 'private-create', requestDigest: quoteInput.requestDigest, expectedStateRevision: '0', resultingStateRevision: '1',
    expectedEpoch: '0', ownerGeneration: '1', draftLocalRevision, verification: privateVerification(operation, height, cap),
  }
  let begun = false, started = false, walletMayHaveOpened = false
  const recheck = async () => {
    writable(); const next = await state(), nextHeight = await client.height(); writable()
    if (Date.now() >= quote.expiresAtMs || BigInt(nextHeight) > BigInt(quote.expiresAtHeight) || BigInt(nextHeight) < BigInt(height)
      || notesRequestDigest(client.chainId, privateNoteMessage(operation, client.realm, cap, next)) !== quoteInput.requestDigest) throw new NotesChainError('stale')
    await assertFeeStillCovers(quote.networkFeeUgnot, () => freshFeeForGasWanted(quote.gasWanted)); writable()
  }
  const [envelope] = decodeManifest(action.prepared.manifest, 1)
  const p = action.prepared, sizes = `title ${p.title.length} B, body ${p.body.length} B, envelope ${p.manifest.length} B`
  const request: SignRequest = {
    title: 'Publish private note', summary: 'Publish an encrypted note that only you can read', label: () => 'Publish private note',
    warns: ['The text is encrypted in this browser. The network still shows your address as the owner, the note’s sizes and when it changes.',
      'The storage deposit stays locked while the note exists: deleting it returns about half; the rest stays locked.'],
    lines: () => [['Account', operation.caller], ['Network', client.chainId], ['Realm', client.realm], ['Note', operation.noteId], ['Operation', operation.operationId],
      ['Who can read', `Only you · your key, generation ${envelope.generation}`], ['Public on the network', `Owner address, encrypted sizes (${sizes}), times`],
      ['Publication fee', gnotAmount(base.config!.createFeeUgnot)],
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
    pendingNote: () => 'Waiting for this exact operation, its ciphertexts and your envelope on chain. Nothing is sent again.',
  }
  return request
}
