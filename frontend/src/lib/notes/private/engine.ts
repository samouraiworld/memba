import { hexToBytes } from '@noble/hashes/utils.js'
import type { ChainNote } from '../chain/schema'
import { check, decimal, id, publicText, realmPath } from '../chain/schema'
import { equalBytes, requireBytes } from '../crypto/bytes'
import { keyCommitment, openField } from '../crypto/content'
import type { EpochContext } from '../crypto/content'

/** The crypto binding of one note epoch: this network and this deployment's realm (there is no default realm). */
export function noteContext(chainId: string, realm: string, note: Pick<ChainNote, 'id' | 'epoch'>): EpochContext {
  return { chainId, realm: realmPath(realm), noteId: hexToBytes(id(note.id)), epoch: Number(decimal(note.epoch, 32, true)) }
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
