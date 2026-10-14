import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, MAX_GAS_WANTED } from '../../grc20'
import type { AminoMsg } from '../../grc20'
import type { SignRequest } from '../../../os/sign/signer'
import type { DraftSession, NotesWriteResult } from '../drafts'
import type { NotesIntentInput, NotesIntents, NotesOperationEvidence } from '../intents'
import { publicNoteMessage } from './messages'
import type { PublicNoteOperation } from './messages'
import { check, decimal, NotesChainError, publicText } from './schema'
import type { ChainConfig, ChainNote } from './schema'
import { newNoteId } from '../config'
import { QuoteExpiredError } from '../../../os/sign/expired'
import type { PublicCapabilities } from './capabilities'
import { publicIntentEvidence, publicVerification } from './recovery'
import type { NotesReadClient } from './client'
import { gnotAmount } from './quote'
import { readPublicContentWritePermission } from './publicPermissions'
import { changedPublicFields } from './draftOperation'

export interface NotesQuote {
  requestDigest: string; chainId: string; atHeight: string; expiresAtHeight: string; expiresAtMs: number
  source: 'simulation' | 'bounded-estimate'
  estimatedDepositUgnot: string; maxDepositUgnot: string; gasWanted: number; networkFeeUgnot: number
}
export interface NotesQuoteInput { chainId: string; message: AminoMsg; requestDigest: string; height: string }
/** The provider must measure the deployed implementation or identify a bounded estimate honestly. */
export type NotesQuoteProvider = (input: NotesQuoteInput) => Promise<NotesQuote>
export interface PublicRequestOptions {
  client: NotesReadClient; operation: PublicNoteOperation; maxDepositUgnot: string; draftLocalRevision: string
  session: DraftSession; intents: NotesIntents; quote: NotesQuoteProvider
  /** Central deployment/rollout gate, checked again immediately before wallet access. */
  isWriteEnabled: () => boolean
  /** Receives the verified note at the resulting revision once this operation is confirmed. */
  onConfirmed?: (note: ChainNote) => void
}
export function notesRequestDigest(chainId: string, message: AminoMsg): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(['memba-notes/v1/transaction', chainId, message]))))
}
function saved<T>(result: NotesWriteResult<T>): T {
  if (result.status !== 'saved') throw new NotesChainError('storage'); return result.value
}
export function validateNotesQuote(quote: NotesQuote, input: Pick<NotesQuoteInput, 'requestDigest' | 'chainId' | 'height'>, cap: string): void {
  check(quote.requestDigest === input.requestDigest && quote.chainId === input.chainId && quote.maxDepositUgnot === cap)
  const height = BigInt(decimal(quote.atHeight, 63, true)), expiry = BigInt(decimal(quote.expiresAtHeight, 63, true))
  check(height === BigInt(input.height) && expiry >= height && expiry <= height + 20n)
  check(Number.isSafeInteger(quote.expiresAtMs) && quote.expiresAtMs > Date.now() && quote.expiresAtMs <= Date.now() + 120_000)
  check(quote.source === 'simulation' || quote.source === 'bounded-estimate')
  check(BigInt(decimal(quote.estimatedDepositUgnot, 63)) <= BigInt(cap))
  check(Number.isSafeInteger(quote.gasWanted) && quote.gasWanted > 0 && quote.gasWanted <= MAX_GAS_WANTED)
  check(Number.isSafeInteger(quote.networkFeeUgnot) && quote.networkFeeUgnot > 0)
}
function expectedRevision(operation: PublicNoteOperation): string {
  return operation.action.kind === 'create' ? '0' : decimal(operation.action.revision, 64, true)
}
async function verifyBase(client: NotesReadClient, operation: PublicNoteOperation, note: ChainNote | null): Promise<void> {
  if (operation.action.kind === 'create') { if (note) throw new NotesChainError('stale'); return }
  const a = operation.action
  if (!note || note.deleted || note.mode < 3 || note.stateRevision !== a.revision
    || (('epoch' in a) && note.epoch !== a.epoch)) throw new NotesChainError('stale')
  const permitted = a.kind === 'commit' || a.kind === 'rename'
    ? await readPublicContentWritePermission(client, note, operation.caller) : note.owner === operation.caller
  if (!permitted) throw new NotesChainError('stale')
  if (a.kind === 'public-writes') {
    const capability = await client.publicCapabilities(note.id); client.assertCurrent()
    if (!capability || note.mode !== 4 || capability.id !== note.id || capability.mode !== 4 || capability.deleted
      || capability.stateRevision !== note.stateRevision || capability.ownerGeneration !== note.ownerGeneration
      || capability.allowPublicWrites === a.enabled) throw new NotesChainError('stale')
  }
}
/** A later operation or a visually identical note is not evidence for this write. */
export function publicOperationEvidence(realm: string, input: NotesIntentInput, operation: PublicNoteOperation, base: ChainNote | null, note: ChainNote | null, afterHeight: string, capabilities?: PublicCapabilities | null): NotesOperationEvidence | null {
  return publicIntentEvidence(realm, { ...input, verification: input.verification ?? publicVerification(operation, base, afterHeight) }, note, capabilities)
}
/** What the signing sheet calls each action, and the note it names (F17): never the raw action kind or note id. */
function describe(operation: PublicNoteOperation, base: ChainNote | null): { label: string; summary: string } {
  const a = operation.action
  let title = 'Untitled note'
  try { title = a.kind === 'create' ? a.title : base ? publicText(base.title, true) : title } catch { /* an unreadable title is named generically */ }
  const named = `“${title}”`
  switch (a.kind) {
    case 'create': return { label: 'Publish note', summary: `Publish ${named}` }
    case 'commit': return { label: 'Publish changes', summary: `Publish changes to ${named}` }
    case 'rename': return { label: 'Rename note', summary: `Rename ${named} to “${a.title}”` }
    case 'delete': return { label: 'Delete note', summary: `Delete ${named}` }
    case 'comments': return a.open ? { label: 'Open comments', summary: `Open comments on ${named}` } : { label: 'Close comments', summary: `Close comments on ${named}` }
    case 'public-writes': return a.enabled ? { label: 'Allow everyone to edit', summary: `Allow everyone to edit ${named}` } : { label: 'Stop community editing', summary: `Stop community editing on ${named}` }
  }
}
const NOT_REPRICED = 'The note changed since this review. Nothing was sent. Cancel, then start again.'
/** No wallet opens here. The request records its complete intention before invoking the broadcaster. */
export async function preparePublicNoteRequest(options: PublicRequestOptions): Promise<SignRequest> {
  let operation = structuredClone(options.operation)
  const { client, intents } = options
  const session = options.session.capture(), { signal } = session
  const current = () => { if (signal.aborted) throw new NotesChainError('session'); client.assertCurrent() }
  const writeAllowed = () => { current(); if (!options.isWriteEnabled()) throw new NotesChainError('disabled') }
  current(); const draftLocalRevision = decimal(options.draftLocalRevision)
  const cap = decimal(options.maxDepositUgnot, 63)
  const [base, config] = await Promise.all([client.note(operation.noteId), client.config()]); current(); await verifyBase(client, operation, base); current()
  // verifyBase pinned base to the commit's revision: unchanged fields are omitted, never re-stored.
  if (base) operation = changedPublicFields(operation, base)
  /** The message, its quote and the intention it records: priced once here, and again by `requote` after an expired quote. */
  const priced = async (operation: PublicNoteOperation, nextConfig: ChainConfig) => {
    const message = publicNoteMessage(operation, cap, nextConfig)
    const height = await client.height(); current()
    const quoteInput = { chainId: client.chainId, message, requestDigest: notesRequestDigest(client.chainId, message), height }
    const quote = structuredClone(await options.quote(structuredClone(quoteInput))); current(); validateNotesQuote(quote, quoteInput, cap)
    const input = {
      scope: { chainId: client.chainId, realm: client.realm, owner: operation.caller, noteId: operation.noteId },
      operationId: operation.operationId, actor: operation.caller, action: operation.action.kind, requestDigest: quoteInput.requestDigest,
      expectedStateRevision: expectedRevision(operation), resultingStateRevision: decimal((BigInt(expectedRevision(operation)) + 1n).toString(), 64, true), expectedEpoch: base?.epoch ?? '0',
      ownerGeneration: base?.ownerGeneration ?? '1', draftLocalRevision,
      verification: publicVerification(operation, base, height),
    }
    return { operation, message, height, quote, input }
  }
  let { message, height, quote, input } = await priced(operation, config)
  let begun = false, sendStarted = false, walletMayHaveOpened = false
  const recheck = async () => {
    writeAllowed()
    const [now, nextConfig, nextHeight] = await Promise.all([client.note(operation.noteId), client.config(), client.height()])
    writeAllowed(); await verifyBase(client, operation, now); writeAllowed()
    if (base && (!now || now.epoch !== base.epoch || now.ownerGeneration !== base.ownerGeneration)) throw new NotesChainError('stale')
    if (BigInt(nextHeight) < BigInt(height) || JSON.stringify(publicNoteMessage(operation, cap, nextConfig)) !== JSON.stringify(message)) throw new NotesChainError('stale')
    // Safe, and said plainly (F7): the review can quote again in place.
    if (Date.now() >= quote.expiresAtMs || BigInt(nextHeight) > BigInt(quote.expiresAtHeight)) throw new QuoteExpiredError()
    await assertFeeStillCovers(quote.networkFeeUgnot, () => freshFeeForGasWanted(quote.gasWanted)); writeAllowed()
  }
  /** After an attempt that stopped before the wallet: the same change, a new operation id and a fresh quote. */
  const requote = async () => {
    if (walletMayHaveOpened) throw new Error('This request reached your wallet, so it cannot be priced again. Check your account, then start again.')
    try {
      writeAllowed()
      const [now, nextConfig] = await Promise.all([client.note(operation.noteId), client.config()]); writeAllowed()
      await verifyBase(client, operation, now); writeAllowed()
      if (base && (!now || now.epoch !== base.epoch || now.ownerGeneration !== base.ownerGeneration)) throw new NotesChainError('stale')
      // An attempt that recorded its intention keeps it (as not sent): the new attempt is another operation.
      const next = await priced(sendStarted ? { ...operation, operationId: newNoteId() } : operation, nextConfig); writeAllowed()
      ;({ operation, message, height, quote, input } = next)
      sendStarted = false; begun = false
    } catch (error) {
      if (error instanceof NotesChainError && error.code === 'stale') throw new Error(NOT_REPRICED)
      throw new Error('A fresh quote could not be prepared. Nothing was sent. Cancel, then try again.')
    }
  }
  const { label, summary } = describe(operation, base)
  return {
    title: label,
    summary,
    lines: () => [
      ['Account', operation.caller], ['Network', client.chainId], ['Realm', client.realm],
      ['Operation', operation.operationId], ['Note', operation.noteId],
      ['Publication fee', gnotAmount(operation.action.kind === 'create' ? config.createFeeUgnot : '0')],
      [quote.source === 'simulation' ? 'Simulated storage deposit' : 'Estimated storage deposit', gnotAmount(quote.estimatedDepositUgnot)],
      ['Maximum storage deposit', gnotAmount(cap)], ['Network fee', gnotAmount(quote.networkFeeUgnot)],
    ],
    warns: ['This note is public. Earlier versions remain in chain history.', ...(operation.action.kind === 'public-writes'
      ? [operation.action.enabled ? 'Any connected wallet will be able to change the title and body. Management and moderation rights stay unchanged.' : 'Collective content editing will stop. Comment permissions stay unchanged.'] : [])],
    label: () => label, prepare: () => ({ msgs: [structuredClone(message)] }), recheck, requote,
    send: async (_choice, beforeSign) => {
      writeAllowed(); if (sendStarted) throw new NotesChainError('stale'); sendStarted = true
      const pending = await intents.list(input.scope); writeAllowed()
      if (pending.some(intent => intent.scope.noteId === operation.noteId && BigInt(intent.expectedStateRevision) >= BigInt(input.expectedStateRevision) && !['confirmed', 'failed', 'not-sent'].includes(intent.phase))) throw new NotesChainError('stale')
      saved(await intents.begin(input, session)); begun = true
      try {
        writeAllowed()
        const result = await doContractBroadcast([structuredClone(message)], '', {
          gasWanted: quote.gasWanted, gasFee: quote.networkFeeUgnot,
          beforeSign: async () => {
            await recheck(); const guard = await beforeSign(); writeAllowed()
            if (guard && !guard()) throw new NotesChainError('session')
            walletMayHaveOpened = true
            return () => { try { writeAllowed(); return Date.now() < quote.expiresAtMs && (!guard || guard()) } catch { return false } }
          },
        })
        saved(await intents.settle(input.scope, input.operationId, 'submitted', session, result.hash))
        return result
      } catch (error) {
        // Even a wallet cancellation plus three unchanged blocks cannot prove non-broadcast.
        if (begun) await intents.settle(input.scope, input.operationId, walletMayHaveOpened ? 'unknown' : 'not-sent', session)
        throw error
      }
    },
    verify: async (_choice, hash) => {
      current(); const note = await client.note(operation.noteId); current()
      const capabilities = operation.action.kind === 'public-writes' ? await client.publicCapabilities(operation.noteId) : undefined; current()
      const evidence = publicOperationEvidence(client.realm, input, operation, base, note, height, capabilities)
      if (!evidence) return false
      if (hash) evidence.txHash = hash
      saved(await intents.confirm(input.scope, input.operationId, evidence, session))
      if (note) options.onConfirmed?.(structuredClone(note))
      return true
    },
    onSettled: outcome => {
      if (begun && outcome === 'unknown') {
        // The driver may stop waiting while the wallet promise is still pending.
        // A failed update keeps the already-durable prepared/submitted lock.
        void intents.settle(input.scope, input.operationId, 'unknown', session).catch(() => {})
      }
    },
    pendingNote: () => 'Waiting for this operation ID and revision on chain. The local draft is retained.',
  }
}
