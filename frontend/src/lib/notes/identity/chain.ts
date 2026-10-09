import { sha256 } from '@noble/hashes/sha2.js'
import type { AminoMsg } from '../../grc20'
import { bech32Encode } from '../../dao/realmAddress'
import type { NotesReadClient } from '../chain/client'
import { address, blob, check, decimal, encode64, id, KEY_SUITE, NOTES_REALM, NOTES_REGISTRY, record } from '../chain/schema'
import { parseBackup } from '../crypto/backup'
import { equalBytes, requireBytes } from '../crypto/bytes'
import type { IdentityChainState, IdentitySetupPlan } from './controller'

export function addressBytes(value: string): Uint8Array {
  address(value)
  const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l', bytes: number[] = []
  let accumulator = 0, bits = 0
  for (const char of value.slice(2, 34)) {
    accumulator = (accumulator << 5) | alphabet.indexOf(char); bits += 5
    if (bits >= 8) { bits -= 8; bytes.push((accumulator >> bits) & 255) }
  }
  return Uint8Array.from(bytes)
}
export async function readChainIdentity(client: NotesReadClient, owner: string): Promise<IdentityChainState> {
  const [key, value] = await Promise.all([client.key(owner), client.seedBackupRaw(owner)]); client.assertCurrent()
  const state: IdentityChainState = { generation: BigInt(key.generation), active: key.active, publicKey: key.publicKey, keyOperationId: key.operationId, keyHeight: BigInt(key.height), backup: null }
  if (value === null) return state
  const v = record(value, ['mode', 'suite', 'generation', 'revision', 'public_key_hash', 'op_id', 'actor', 'height', 'record'])
  check((v.mode === 1 || v.mode === 2) && v.suite === KEY_SUITE && address(v.actor) === owner)
  const backup = blob(v.record, 365), binding = parseBackup(backup).binding
  check(binding.chainId === client.chainId && binding.realm === NOTES_REALM && bech32Encode('g', binding.address) === owner
    && binding.generation.toString() === decimal(v.generation, 64, true) && binding.mode === (v.mode === 1 ? 'standard' : 'vault')
    && equalBytes(binding.publicKeyHash, blob(v.public_key_hash, 32)))
  state.backup = { revision: BigInt(decimal(v.revision, 64, true)), record: backup, operationId: id(v.op_id), height: BigInt(decimal(v.height, 63, true)) }
  return state
}
export interface IdentityDepositCaps { registryUgnot: string; backupUgnot: string }
/** Two direct account calls in one transaction: either both persist or neither does. */
export function identitySetupMessages(plan: IdentitySetupPlan, caller: string, chainId: string, caps: IdentityDepositCaps): AminoMsg[] {
  address(caller); id(plan.operationId); requireBytes(plan.publicKey, 1216)
  const expected = decimal(plan.expectedGeneration.toString()), generation = decimal(plan.generation.toString(), 64, true)
  check(BigInt(generation) === BigInt(expected) + 1n && plan.expectedBackupRevision < 0xffffffffffffffffn)
  const binding = parseBackup(plan.backup).binding
  check(binding.mode === plan.mode && binding.generation === plan.generation && binding.chainId === chainId && binding.realm === NOTES_REALM
    && bech32Encode('g', binding.address) === caller && equalBytes(binding.publicKeyHash, sha256(plan.publicKey)))
  const op = encode64(Uint8Array.from(plan.operationId.match(/../g)!, value => parseInt(value, 16)))
  return [
    { type: 'vm/MsgCall', value: { caller, send: '', pkg_path: NOTES_REGISTRY, func: 'RegisterKey', args: [KEY_SUITE, expected, encode64(plan.publicKey), op], max_deposit: `${decimal(caps.registryUgnot, 63)}ugnot` } },
    { type: 'vm/MsgCall', value: { caller, send: '', pkg_path: NOTES_REALM, func: 'SetSeedBackup', args: [decimal(plan.expectedBackupRevision.toString()), encode64(plan.backup), op], max_deposit: `${decimal(caps.backupUgnot, 63)}ugnot` } },
  ]
}
