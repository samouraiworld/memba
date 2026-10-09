import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted } from '../../grc20'
import type { AminoMsg } from '../../grc20'
import type { SignRequest } from '../../../os/sign/signer'
import type { DraftSession, NotesWriteResult } from '../drafts'
import type { NotesIntents, NotesIntentInput } from '../intents'
import type { NotesReadClient } from '../chain/client'
import { decimal, NOTES_REGISTRY, NotesChainError } from '../chain/schema'
import { validateNotesQuote } from '../chain/request'
import type { NotesQuote } from '../chain/request'
import { identitySetupMessages, readChainIdentity } from './chain'
import type { IdentityDepositCaps } from './chain'
import type { NotesIdentityController } from './controller'
import { identityIntentScope, identityVerification, identityIntentEvidence } from './requestRecovery'
export { identityIntentScope } from './requestRecovery'

export interface IdentityQuoteInput { chainId: string; messages: AminoMsg[]; requestDigest: string; height: string }
export type IdentityQuoteProvider = (input: IdentityQuoteInput) => Promise<NotesQuote>
export interface IdentityRequestOptions {
  controller: NotesIdentityController; client: NotesReadClient; owner: string; caps: IdentityDepositCaps
  quote: IdentityQuoteProvider; intents: NotesIntents; session: DraftSession; isWriteEnabled: () => boolean
}
function saved<T>(value: NotesWriteResult<T>): T { if (value.status !== 'saved') throw new NotesChainError('storage'); return value.value }
export async function prepareIdentitySetupRequest(options: IdentityRequestOptions): Promise<SignRequest> {
  const { client, controller, intents, owner } = options, guard = options.session.capture()
  const current = () => { client.assertCurrent(); if (guard.signal.aborted) throw new NotesChainError('session') }
  const enabled = () => { current(); if (!options.isWriteEnabled()) throw new NotesChainError('disabled') }
  enabled()
  const plan = controller.preparedPlan(), caps = { ...options.caps }
  const reviewed = () => { enabled(); if (controller.preparedPlan().operationId !== plan.operationId) throw new NotesChainError('stale') }
  const messages = identitySetupMessages(plan, owner, client.chainId, caps)
  const totalCap = decimal((BigInt(caps.registryUgnot) + BigInt(caps.backupUgnot)).toString(), 63)
  const checkBase = async () => {
    const state = await readChainIdentity(client, owner); reviewed()
    if (state.generation !== plan.expectedGeneration || (state.backup?.revision ?? 0n) !== plan.expectedBackupRevision) throw new NotesChainError('stale')
  }
  await checkBase()
  const height = await client.height(); enabled()
  const requestDigest = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(['memba-notes/v1/identity-transaction', client.chainId, messages]))))
  const quoteInput = { chainId: client.chainId, messages, requestDigest, height }
  const quote = structuredClone(await options.quote(structuredClone(quoteInput))); reviewed(); validateNotesQuote(quote, quoteInput, totalCap)
  const input: NotesIntentInput = {
    scope: identityIntentScope(client.chainId, owner), operationId: plan.operationId, actor: owner, action: 'identity-setup', requestDigest,
    expectedStateRevision: plan.expectedGeneration.toString(), resultingStateRevision: plan.generation.toString(),
    expectedEpoch: plan.expectedBackupRevision.toString(), ownerGeneration: plan.expectedGeneration.toString(), draftLocalRevision: '0',
    verification: identityVerification(plan, height),
  }
  let attempted = false, begun = false, walletMayHaveOpened = false
  const recheck = async () => {
    enabled(); await checkBase()
    const freshHeight = await client.height(); enabled()
    if (Date.now() >= quote.expiresAtMs || BigInt(freshHeight) < BigInt(height) || BigInt(freshHeight) > BigInt(quote.expiresAtHeight)) throw new NotesChainError('stale')
    await assertFeeStillCovers(quote.networkFeeUgnot, () => freshFeeForGasWanted(quote.gasWanted)); enabled()
  }
  return {
    title: plan.migrationPartial ? 'Move Notes identity to Vault' : 'Set up Notes identity',
    summary: `Register ${plan.mode === 'vault' ? 'Vault' : 'Standard'} encryption identity, generation ${plan.generation}`,
    lines: () => [
      ['Account', owner], ['Network', client.chainId], ['Identity generation', plan.generation.toString()],
      ['Operation', plan.operationId], ['Registry', NOTES_REGISTRY], ['Backup', client.realm],
      [quote.source === 'simulation' ? 'Simulated storage deposit (ugnot)' : 'Estimated storage deposit (ugnot)', quote.estimatedDepositUgnot],
      ['Registry deposit cap (ugnot)', caps.registryUgnot], ['Backup deposit cap (ugnot)', caps.backupUgnot], ['Network fee (ugnot)', String(quote.networkFeeUgnot)],
    ],
    warns: plan.migrationPartial
      ? ['This registers a new independent identity. Existing notes and received shares still need rotation. Old Standard data remains exposed to its historical recovery path.']
      : plan.mode === 'standard' ? ['A matching wallet unlock signature can recover this identity from its on-chain backup. Keep your Notes recovery phrase and encrypted recovery file.']
        : ['Keep your Notes recovery phrase and encrypted recovery file. Losing them can permanently lose access.'],
    acks: ['I saved the Notes recovery phrase and encrypted recovery file separately.'],
    label: () => 'Set up Notes identity', prepare: () => ({ msgs: structuredClone(messages) }), recheck,
    send: async (_choice, beforeSign) => {
      reviewed(); if (attempted) throw new NotesChainError('stale'); attempted = true
      saved(await intents.begin(input, guard)); begun = true
      try {
        reviewed()
        const result = await doContractBroadcast(structuredClone(messages), '', {
          gasWanted: quote.gasWanted, gasFee: quote.networkFeeUgnot,
          beforeSign: async () => {
            await recheck(); const driverGuard = await beforeSign(); reviewed()
            if (driverGuard && !driverGuard()) throw new NotesChainError('session')
            walletMayHaveOpened = true
            return () => { try { reviewed(); return Date.now() < quote.expiresAtMs && (!driverGuard || driverGuard()) } catch { return false } }
          },
        })
        saved(await intents.settle(input.scope, input.operationId, 'submitted', guard, result.hash)); return result
      } catch (error) {
        await intents.settle(input.scope, input.operationId, walletMayHaveOpened ? 'unknown' : 'not-sent', guard); throw error
      }
    },
    verify: async (_choice, hash) => {
      current(); const state = await readChainIdentity(client, owner); current()
      const evidence = identityIntentEvidence(client.chainId, input, state)
      if (!evidence || !await controller.confirmSetup()) return false
      current()
      if (hash) evidence.txHash = hash
      saved(await intents.confirm(input.scope, input.operationId, evidence, guard)); return true
    },
    onSettled: outcome => { if (begun && outcome === 'unknown') void intents.settle(input.scope, input.operationId, 'unknown', guard).catch(() => {}) },
    pendingNote: () => 'Waiting for both the registry and backup receipts from this exact atomic transaction. No replacement identity is created.',
  }
}
