// Test only: seals a private note the way the reviewed 10-09 engine does (prepareEncryptedEpoch, recipientManifest,
// encodePrivateText), so the reader is tested against real ciphertext. The signing PR moves these into engine.ts.
import { sha256 } from '@noble/hashes/sha2.js'
import type { ChainKey } from '../../chain/schema'
import { address, check, decimal, publicText } from '../../chain/schema'
import { randomBytes, requireBytes, requireEpoch } from '../../crypto/bytes'
import { keyCommitment, sealField } from '../../crypto/content'
import type { EpochContext } from '../../crypto/content'
import { encodeManifest } from '../../crypto/manifest'
import type { Recipient } from '../../crypto/manifest'
import { wrapForReader } from '../../crypto/wrap'
import { addressBytes } from '../../identity/chain'
import { noteContext } from '../engine'

export interface EpochRecipient { key: ChainKey; writer: boolean }
export interface EncryptedEpoch { title: Uint8Array; body: Uint8Array; manifest: Uint8Array; commitment: Uint8Array }
function encodePrivateText(value: string, title = false): Uint8Array {
  check(typeof value === 'string' && value.length <= 131072)
  const bytes = new TextEncoder().encode(value)
  try { check(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) === value); publicText(bytes, title); return bytes }
  catch (error) { bytes.fill(0); throw error }
}
function recipientManifest(key: Uint8Array, context: EpochContext, mode: 0 | 1 | 2, owner: string, recipients: readonly EpochRecipient[]): Uint8Array {
  check((mode === 0 || mode === 1 || mode === 2) && recipients.length >= 1 && recipients.length <= 32)
  address(owner); requireBytes(key, 32)
  check(recipients.some(r => r.key.address === owner && r.writer) && (mode !== 0 || recipients.length === 1))
  const entries: Recipient[] = recipients.map(({ key: identity, writer }) => {
    const generation = BigInt(decimal(identity.generation, 64, true))
    return { address: addressBytes(identity.address), writer, generation, publicKeyHash: sha256(identity.publicKey),
      wrap: wrapForReader(key, identity.publicKey, { ...context, reader: identity.address, generation }) }
  })
  return encodeManifest(entries, context.epoch)
}
export function sealPrivateNote(input: {
  chainId: string; realm: string; noteId: string; epoch: number; titleRevision: bigint; bodyRevision: bigint
  mode: 0 | 1 | 2; owner: string; recipients: readonly EpochRecipient[]; title: string; body: string
}): EncryptedEpoch {
  requireEpoch(input.epoch)
  const context = noteContext(input.chainId, input.realm, { id: input.noteId, epoch: String(input.epoch) })
  const title = encodePrivateText(input.title, true), body = encodePrivateText(input.body), key = randomBytes(32)
  try {
    return { title: sealField(key, { ...context, field: 'title', fieldRevision: input.titleRevision }, title),
      body: sealField(key, { ...context, field: 'body', fieldRevision: input.bodyRevision }, body),
      manifest: recipientManifest(key, context, input.mode, input.owner, input.recipients), commitment: keyCommitment(key, context) }
  } finally { key.fill(0); title.fill(0); body.fill(0) }
}
