import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { DraftSession } from '../drafts'
import { validIdentityVerification } from '../intents'
import type { IdentityIntentVerification, NotesIntent, NotesIntentInput, NotesIntents, NotesOperationEvidence } from '../intents'
import type { NotesReadClient } from '../chain/client'
import { check, decimal, NOTES_REGISTRY, record } from '../chain/schema'
import { parseBackup } from '../crypto/backup'
import type { IdentityChainState, IdentitySetupPlan } from './controller'
import { readChainIdentity } from './chain'

const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes))
/** Separate from real note IDs and comment receipt partitions. */
export function identityIntentScope(chainId: string, owner: string) {
  return { chainId, realm: NOTES_REGISTRY, owner, noteId: hash(new TextEncoder().encode(`memba-notes/v1/identity-intent:${owner}`)).slice(0, 32) }
}
export function identityVerification(plan: IdentitySetupPlan, quoteHeight: string): IdentityIntentVerification {
  const value: IdentityIntentVerification = { kind: 'identity-v1', mode: plan.mode, generation: plan.generation.toString(),
    backupRevision: (plan.expectedBackupRevision + 1n).toString(), publicKeySha256: hash(plan.publicKey), backupSha256: hash(plan.backup), quoteHeight }
  check(validIdentityVerification(value)); return value
}
/** The two current receipts must prove this exact atomic registration + backup, not a later identity. */
export function identityIntentEvidence(chainId: string, input: NotesIntentInput, state: IdentityChainState): NotesOperationEvidence | null {
  const v = input.verification, expected = identityIntentScope(chainId, input.actor), backup = state.backup
  if (!validIdentityVerification(v) || input.action !== 'identity-setup' || input.scope.chainId !== chainId
    || input.scope.realm !== expected.realm || input.scope.owner !== expected.owner || input.scope.noteId !== expected.noteId
    || input.ownerGeneration !== input.expectedStateRevision || v.generation !== input.resultingStateRevision
    || BigInt(v.generation) !== BigInt(input.expectedStateRevision) + 1n || BigInt(v.backupRevision) !== BigInt(input.expectedEpoch) + 1n
    || !state.active || state.generation.toString() !== v.generation || hash(state.publicKey) !== v.publicKeySha256
    || state.keyOperationId !== input.operationId || !backup || backup.operationId !== input.operationId
    || backup.revision.toString() !== v.backupRevision || backup.height !== state.keyHeight || state.keyHeight <= BigInt(v.quoteHeight)
    || hash(backup.record) !== v.backupSha256 || parseBackup(backup.record).binding.mode !== v.mode) return null
  return { scope: { ...input.scope }, operationId: input.operationId, actor: input.actor, stateRevision: v.generation,
    height: state.keyHeight.toString(), outcome: 'applied' }
}
/** Explicit reload check; no wallet, retry, controller activation, or deletion of the saved receipt. */
export async function recoverIdentityIntent(client: NotesReadClient, intents: NotesIntents, intent: NotesIntent, session: DraftSession): Promise<'confirmed' | 'unknown'> {
  const guard = session.capture(), scope = { ...intent.scope }, operationId = intent.operationId
  const current = () => { check(!guard.signal.aborted); client.assertCurrent() }
  try {
    current(); if (scope.chainId !== client.chainId || scope.realm !== NOTES_REGISTRY) return 'unknown'
    const stored = await intents.get(scope, operationId); current()
    if (!stored || !validIdentityVerification(stored.verification)) return 'unknown'
    if (stored.phase === 'confirmed') return 'confirmed'
    if (!['prepared', 'submitted', 'unknown'].includes(stored.phase)) return 'unknown'
    const state = await readChainIdentity(client, scope.owner); current()
    const evidence = identityIntentEvidence(client.chainId, stored, state); if (!evidence) return 'unknown'
    const result = await intents.confirm(scope, operationId, evidence, guard); current()
    return result.status === 'saved' ? 'confirmed' : 'unknown'
  } catch { return 'unknown' }
}

/**
 * Whether a saved setup receipt can still take effect. RegisterKey and SetSeedBackup are compare-and-swap calls on the
 * registry generation and the backup revision, both only ever grow and both are one atomic transaction: the setup can
 * apply only while the chain still shows the generation and revision it expected.
 * - `confirmed`: the exact receipts of this operation are on chain (recoverIdentityIntent).
 * - `pending`: it may still apply; nothing else is offered for this receipt and nothing is signed again.
 * - `failed`: provably never applied (generation+1 went to another operation, or the backup revision moved while the
 *   generation did not); settled through the failed-evidence path, the receipt is kept.
 * - `superseded`: it can never apply any more; whether it applied earlier is not decided, so it is not settled.
 * No wallet; a read that fails keeps the receipt `pending`.
 */
export async function identityIntentStanding(client: NotesReadClient, intents: NotesIntents, intent: NotesIntent, session: DraftSession): Promise<'confirmed' | 'pending' | 'failed' | 'superseded'> {
  if (await recoverIdentityIntent(client, intents, intent, session) === 'confirmed') return 'confirmed'
  const guard = session.capture(), current = () => { check(!guard.signal.aborted); client.assertCurrent() }
  try {
    current()
    const stored = await intents.get(intent.scope, intent.operationId); current()
    if (!stored || stored.action !== 'identity-setup' || !['prepared', 'submitted', 'unknown'].includes(stored.phase)) return stored?.phase === 'confirmed' ? 'confirmed' : 'superseded'
    const [key, raw] = await Promise.all([client.key(stored.scope.owner), client.seedBackupRaw(stored.scope.owner)]); current()
    const generation = BigInt(key.generation), expected = BigInt(stored.expectedStateRevision), expectedRevision = BigInt(stored.expectedEpoch)
    const revision = raw === null ? 0n : BigInt(decimal(record(raw, ['mode', 'suite', 'generation', 'revision', 'public_key_hash', 'op_id', 'actor', 'height', 'record']).revision, 64, true))
    if (generation < expected || (generation === expected && revision <= expectedRevision)) return 'pending'
    if ((generation === expected + 1n && key.operationId !== stored.operationId) || generation === expected) {
      const height = await client.height(); current()
      const result = await intents.confirm(stored.scope, stored.operationId, { scope: { ...stored.scope }, operationId: stored.operationId, actor: stored.actor,
        stateRevision: stored.resultingStateRevision, height: decimal(height, 63, true), outcome: 'failed' }, guard); current()
      return result.status === 'saved' ? 'failed' : 'pending'
    }
    return 'superseded'
  } catch { return 'pending' }
}
