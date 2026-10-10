import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, MAX_GAS_WANTED } from '../../grc20'
import type { AminoMsg } from '../../grc20'
import type { SignRequest } from '../../../os/sign/signer'
import type { DraftSession, NotesWriteResult } from '../drafts'
import type { NotesIntentInput, NotesIntents, NotesOperationEvidence } from '../intents'
import { publicNoteMessage } from './messages'
import type { PublicNoteOperation } from './messages'
import { check, decimal, NOTES_REALM, NotesChainError } from './schema'
import type { ChainNote } from './schema'
import type { PublicCapabilities } from './capabilities'
import { publicIntentEvidence, publicVerification } from './recovery'
import type { NotesReadClient } from './client'
import { gnotAmount } from './quote'
import { readPublicContentWritePermission } from './publicPermissions'

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
export function publicOperationEvidence(input: NotesIntentInput, operation: PublicNoteOperation, base: ChainNote | null, note: ChainNote | null, afterHeight: string, capabilities?: PublicCapabilities | null): NotesOperationEvidence | null {
  return publicIntentEvidence({ ...input, verification: input.verification ?? publicVerification(operation, base, afterHeight) }, note, capabilities)
}
/** No wallet opens here. The request records its complete intention before invoking the broadcaster. */
export async function preparePublicNoteRequest(options: PublicRequestOptions): Promise<SignRequest> {
  const operation = structuredClone(options.operation), { client, intents } = options
  const session = options.session.capture(), { signal } = session
  const current = () => { if (signal.aborted) throw new NotesChainError('session'); client.assertCurrent() }
  const writeAllowed = () => { current(); if (!options.isWriteEnabled()) throw new NotesChainError('disabled') }
  current(); const draftLocalRevision = decimal(options.draftLocalRevision)
  const cap = decimal(options.maxDepositUgnot, 63)
  const [base, config] = await Promise.all([client.note(operation.noteId), client.config()]); current(); await verifyBase(client, operation, base); current()
  const message = publicNoteMessage(operation, cap, config)
  const height = await client.height(); current()
  const quoteInput = { chainId: client.chainId, message, requestDigest: notesRequestDigest(client.chainId, message), height }
  const quote = structuredClone(await options.quote(structuredClone(quoteInput))); current(); validateNotesQuote(quote, quoteInput, cap)
  const resultingRevision = decimal((BigInt(expectedRevision(operation)) + 1n).toString(), 64, true)
  const input = {
    scope: { chainId: client.chainId, realm: NOTES_REALM, owner: operation.caller, noteId: operation.noteId },
    operationId: operation.operationId, actor: operation.caller, action: operation.action.kind, requestDigest: quoteInput.requestDigest,
    expectedStateRevision: expectedRevision(operation), resultingStateRevision: resultingRevision, expectedEpoch: base?.epoch ?? '0',
    ownerGeneration: base?.ownerGeneration ?? '1', draftLocalRevision,
    verification: publicVerification(operation, base, height),
  }
  let begun = false, sendStarted = false, walletMayHaveOpened = false
  const recheck = async () => {
    writeAllowed()
    const [now, nextConfig, nextHeight] = await Promise.all([client.note(operation.noteId), client.config(), client.height()])
    writeAllowed(); await verifyBase(client, operation, now); writeAllowed()
    if (base && (!now || now.epoch !== base.epoch || now.ownerGeneration !== base.ownerGeneration)) throw new NotesChainError('stale')
    if (Date.now() >= quote.expiresAtMs || BigInt(nextHeight) > BigInt(quote.expiresAtHeight) || BigInt(nextHeight) < BigInt(height)
      || JSON.stringify(publicNoteMessage(operation, cap, nextConfig)) !== JSON.stringify(message)) throw new NotesChainError('stale')
    await assertFeeStillCovers(quote.networkFeeUgnot, () => freshFeeForGasWanted(quote.gasWanted)); writeAllowed()
  }
  const label = operation.action.kind === 'public-writes' ? operation.action.enabled ? 'Allow everyone to edit' : 'Stop public editing'
    : operation.action.kind === 'create' ? 'Publish note' : 'Update note'
  return {
    title: label,
    summary: `${operation.action.kind}: public note ${operation.noteId}`,
    lines: () => [
      ['Account', operation.caller], ['Network', client.chainId], ['Realm', NOTES_REALM],
      ['Operation', operation.operationId], ['Note', operation.noteId],
      ['Publication fee', gnotAmount(operation.action.kind === 'create' ? config.createFeeUgnot : '0')],
      [quote.source === 'simulation' ? 'Simulated storage deposit' : 'Estimated storage deposit', gnotAmount(quote.estimatedDepositUgnot)],
      ['Maximum storage deposit', gnotAmount(cap)], ['Network fee', gnotAmount(quote.networkFeeUgnot)],
    ],
    warns: ['This note is public. Earlier versions remain in chain history.', ...(operation.action.kind === 'public-writes'
      ? [operation.action.enabled ? 'Any connected wallet will be able to change the title and body. Management and moderation rights stay unchanged.' : 'Collective content editing will stop. Comment permissions stay unchanged.'] : [])],
    label: () => label, prepare: () => ({ msgs: [structuredClone(message)] }), recheck,
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
      const evidence = publicOperationEvidence(input, operation, base, note, height, capabilities)
      if (!evidence) return false
      if (hash) evidence.txHash = hash
      saved(await intents.confirm(input.scope, input.operationId, evidence, session)); return true
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
