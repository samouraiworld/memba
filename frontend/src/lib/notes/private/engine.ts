import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { ChainKey, ChainNote } from '../chain/schema'
import { address, check, decimal, id, publicText, realmPath } from '../chain/schema'
import { equalBytes, randomBytes, requireBytes, requireEpoch } from '../crypto/bytes'
import { keyCommitment, openField, sealField } from '../crypto/content'
import type { EpochContext } from '../crypto/content'
import { encodeManifest } from '../crypto/manifest'
import type { Recipient } from '../crypto/manifest'
import { wrapForReader } from '../crypto/wrap'
import { addressBytes } from '../identity/chain'

/** The crypto binding of one note epoch: this network and this deployment's realm (there is no default realm). */
export function noteContext(chainId: string, realm: string, note: Pick<ChainNote, 'id' | 'epoch'>): EpochContext {
  return { chainId, realm: realmPath(realm), noteId: hexToBytes(id(note.id)), epoch: Number(decimal(note.epoch, 32, true)) }
}
export interface EpochRecipient { key: ChainKey; writer: boolean }
export interface EncryptedEpoch { chainId: string; realm: string; noteId: string; mode: 0 | 1 | 2; epoch: number; titleRevision: bigint; bodyRevision: bigint; title: Uint8Array; body: Uint8Array; manifest: Uint8Array; commitment: Uint8Array }
export function encodePrivateText(value: string, title = false): Uint8Array {
  check(typeof value === 'string' && value.length <= 131072)
  const bytes = new TextEncoder().encode(value)
  try { check(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) === value); publicText(bytes, title); return bytes }
  catch (error) { bytes.fill(0); throw error }
}
export function recipientManifest(key: Uint8Array, context: EpochContext, mode: 0 | 1 | 2, owner: string, recipients: readonly EpochRecipient[]): Uint8Array {
  check(realmPath(context.realm) && (mode === 0 || mode === 1 || mode === 2) && recipients.length >= 1 && recipients.length <= 32)
  address(owner); requireBytes(key, 32)
  check(recipients.some(r => r.key.address === owner && r.writer) && (mode !== 0 || recipients.length === 1))
  check(new Set(recipients.map(r => r.key.address)).size === recipients.length)
  const entries: Recipient[] = recipients.map(({ key: identity, writer }) => {
    address(identity.address); check(identity.active && typeof writer === 'boolean' && (mode !== 2 || writer))
    const generation = BigInt(decimal(identity.generation, 64, true)); requireBytes(identity.publicKey, 1216)
    return { address: addressBytes(identity.address), writer, generation, publicKeyHash: sha256(identity.publicKey),
      wrap: wrapForReader(key, identity.publicKey, { ...context, reader: identity.address, generation }) }
  })
  return encodeManifest(entries, context.epoch)
}
/** Personal-owner create/rotation, sealed for this deployment's realm. Callers must recheck registry generations before signing. */
export function prepareEncryptedEpoch(input: {
  chainId: string; realm: string; noteId: string; epoch: number; titleRevision: bigint; bodyRevision: bigint
  mode: 0 | 1 | 2; owner: string; recipients: readonly EpochRecipient[]; title: string; body: string
}): EncryptedEpoch {
  requireEpoch(input.epoch)
  const context = noteContext(input.chainId, input.realm, { id: input.noteId, epoch: String(input.epoch) })
  const title = encodePrivateText(input.title, true), key = randomBytes(32)
  let body: Uint8Array | undefined
  try {
    body = encodePrivateText(input.body)
    return { chainId: input.chainId, realm: context.realm, noteId: input.noteId, mode: input.mode, epoch: input.epoch, titleRevision: input.titleRevision, bodyRevision: input.bodyRevision,
      title: sealField(key, { ...context, field: 'title', fieldRevision: input.titleRevision }, title),
      body: sealField(key, { ...context, field: 'body', fieldRevision: input.bodyRevision }, body),
      manifest: recipientManifest(key, context, input.mode, input.owner, input.recipients), commitment: keyCommitment(key, context) }
  } finally { key.fill(0); title.fill(0); body?.fill(0) }
}

/**
 * One decrypted note, read only. No persistent storage, and no epoch key kept: the title and body are opened once and
 * the caller zeroes its key. Returned strings are caller-owned and must leave the UI on dispose.
 */
export class OpenPrivateNote {
  #title: Uint8Array
  #body: Uint8Array
  #closed = false
  #lifetime = new AbortController()
  #cleanup: (() => void) | undefined
  readonly note: ChainNote
  readonly context: EpochContext
  get signal(): AbortSignal { return this.#lifetime.signal }
  constructor(chainId: string, realm: string, note: ChainNote, key: Uint8Array, readonly exposed: boolean, private readonly current: () => boolean) {
    this.note = { ...note, title: note.title.slice(), body: note.body?.slice(), commitment: note.commitment.slice() }
    this.context = noteContext(chainId, realm, note)
    check(!note.deleted && note.mode <= 2 && note.body && equalBytes(keyCommitment(key, this.context), note.commitment))
    requireBytes(key, 32); this.#title = new Uint8Array(); this.#body = new Uint8Array()
    try {
      this.#title = openField(key, { ...this.context, field: 'title', fieldRevision: BigInt(note.titleRevision) }, note.title)
      this.#body = openField(key, { ...this.context, field: 'body', fieldRevision: BigInt(note.bodyRevision) }, note.body)
      publicText(this.#title, true); publicText(this.#body); this.assert()
    } catch (error) { this.dispose(); throw error }
  }
  attachCleanup(cleanup: () => void): void { if (this.#closed) cleanup(); else this.#cleanup = cleanup }
  private assert(): void { if (this.#closed || !this.current()) { this.dispose(); throw new Error('Notes private session closed') } }
  assertActive(): void { this.assert() }
  text(): { title: string; body: string } { this.assert(); return { title: publicText(this.#title, true), body: publicText(this.#body) } }
  dispose = (): void => {
    if (this.#closed) return
    this.#closed = true; this.#title.fill(0); this.#body.fill(0); this.#lifetime.abort(); this.#cleanup?.(); this.#cleanup = undefined
  }
}
