import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { concat, domain, networkBytes, text, u8, u32, u64 } from '../crypto/bytes'
import { address, check, decimal, id, NOTES_REALM } from './schema'
import type { ChainNote } from './schema'

const ACTIONS = ['AcceptOwnership', 'Commit', 'Rename', 'Rotate', 'ApplyAccess', 'Publish', 'Reveal', 'Delete', 'AddWriter', 'RemoveWriter', 'ProposeOwner', 'SetPolicy', 'SetCommentMode', 'SetListed', 'ModerateListing', 'SetGovWriters', 'HideComment', 'ResolveComment', 'RejectAccessRequest', 'Purge'] as const
export type NotesGovernanceAction = typeof ACTIONS[number]
export const MAX_GOV_PAYLOAD_BYTES = 231 + 135223 + (2 + 32 * 1299) + 128
/** Match the realm digest byte-for-byte; callers must separately encode and review the typed action payload. */
export function notesGovernanceDigest(chainId: string, note: ChainNote, action: NotesGovernanceAction, payload: Uint8Array, operationId: string): string {
  check(ACTIONS.includes(action) && payload.length >= 1 && payload.length <= MAX_GOV_PAYLOAD_BYTES && payload[0] === 1)
  check(Number.isInteger(note.mode) && note.mode >= 0 && note.mode <= 4 && (note.commitment.length === 0 || note.commitment.length === 32))
  const preimage = concat(
    domain('gov-operation'), networkBytes({ chainId, realm: NOTES_REALM }), hexToBytes(id(note.id)),
    u64(BigInt(decimal(note.ownerGeneration, 64, true))), u64(BigInt(decimal(note.stateRevision, 64, true))), u32(Number(decimal(note.epoch, 32))), u8(note.mode),
    text(address(note.owner)), text(address(note.pendingOwner, true)), u32(note.commitment.length), note.commitment,
    text(action), sha256(payload), hexToBytes(id(operationId)),
  )
  return bytesToHex(sha256(preimage))
}
