import { hexToBytes } from '@noble/hashes/utils.js'
import type { AminoMsg } from '../../grc20'
import { address, check, decimal, encode64, id, realmPath } from './schema'

// Ported from the reviewed 10-09 accessMessages.ts (2399ebef), Delete only in this version (writers and ownership
// transfer arrive with their own reviews), on the deployment's realm.
export type AccessAction = { kind: 'delete' }
export interface AccessOperation { caller: string; noteId: string; operationId: string; revision: string; ownerGeneration: string; action: AccessAction }
export function accessMessage(operation: AccessOperation, realm: string, maxDepositUgnot: string): AminoMsg {
  const caller = address(operation.caller)
  check(operation.action.kind === 'delete'); decimal(operation.ownerGeneration, 64, true)
  const args = [encode64(hexToBytes(id(operation.noteId))), decimal(operation.revision, 64, true), encode64(hexToBytes(id(operation.operationId)))]
  return { type: 'vm/MsgCall', value: { caller, send: '', pkg_path: realmPath(realm), func: 'Delete', args, max_deposit: `${decimal(maxDepositUgnot, 63)}ugnot` } }
}
