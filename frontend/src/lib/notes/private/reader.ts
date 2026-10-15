import { sha256 } from '@noble/hashes/sha2.js'
import type { NotesReadClient } from '../chain/client'
import { address, check, NotesChainError, publicText } from '../chain/schema'
import type { ChainNote } from '../chain/schema'
import { equalBytes } from '../crypto/bytes'
import { keyCommitment, openField, sealField } from '../crypto/content'
import { encodeManifest } from '../crypto/manifest'
import type { Recipient } from '../crypto/manifest'
import { unwrapForReader } from '../crypto/wrap'
import { addressBytes } from '../identity/chain'
import type { NotesIdentityController } from '../identity/controller'
import { encodePrivateText, noteContext, OpenPrivateNote } from './engine'
import { parseEpochPage, parseReaders, parseWrap } from './schema'

/**
 * This account cannot open the note with its current key: no envelope for it in the current epoch (`none`), or one made
 * for another key of this account (`other-key`, an earlier generation or a key changed outside Memba).
 */
export class PrivateNoteNoAccess extends Error {
  constructor(readonly reason: 'none' | 'other-key') { super(`Notes private: no access (${reason})`); this.name = 'PrivateNoteNoAccess' }
}
type Access = { kind: 'identity'; owner: string; identity: NotesIdentityController }
/** Captures the caller's abort signal before any RPC. */
export async function readEncryptedNote(client: NotesReadClient, noteId: string, options: { access: Access; signal: AbortSignal }): Promise<OpenPrivateNote> {
  const { access, signal } = options
  let invalidated = false, delivered = false, key: Uint8Array | undefined, opened: OpenPrivateNote | undefined
  const invalidate = () => { invalidated = true; key?.fill(0); opened?.dispose() }
  signal.addEventListener('abort', invalidate)
  const generation = access.identity.getSnapshot().generation
  // A lock is irreversible for this invocation, even if the same identity unlocks again before RPC returns.
  const unsubscribe = access.identity.subscribe(() => {
    const state = access.identity.getSnapshot()
    if (state.phase !== 'unlocked' || state.generation !== generation) invalidate()
  })
  const current = () => {
    if (signal.aborted || invalidated) return false
    try { client.assertCurrent(); return access.identity.getSnapshot().phase === 'unlocked' && access.identity.getSnapshot().generation === generation } catch { return false }
  }
  const assert = () => { if (!current()) throw new NotesChainError('session') }
  try {
    assert()
    const note = await client.note(noteId); assert(); check(note && !note.deleted && note.mode <= 2 && note.body)
    const epoch = parseEpochPage(await client.epochMetadataRaw(note.id, note.epoch), note.epoch); assert()
    check(equalBytes(epoch.commitment, note.commitment))
    const who = address(access.owner), raw = await client.wrapRaw(note.id, note.epoch, who); assert()
    if (raw === null) throw new PrivateNoteNoAccess('none')
    const wrap = parseWrap(raw, note.epoch, who)
    if (access.identity.getSnapshot().generation !== wrap.generation) throw new PrivateNoteNoAccess('other-key')
    await access.identity.use(identity => {
      if (!equalBytes(sha256(identity.publicKey), wrap.publicKeyHash)) throw new PrivateNoteNoAccess('other-key')
      key = unwrapForReader(wrap.wrap, identity.secretKey, identity.publicKey, { ...noteContext(client.chainId, client.realm, note), reader: who, generation: BigInt(wrap.generation) })
    }); assert()
    const final = await client.noteMetadata(note.id); assert()
    if (!final || final.stateRevision !== note.stateRevision || final.epoch !== note.epoch || final.ownerGeneration !== note.ownerGeneration) throw new NotesChainError('stale')
    check(key)
    opened = new OpenPrivateNote(client.chainId, client.realm, note, key, epoch.revealedKey.length === 32, current)
    const view = opened
    view.attachCleanup(() => { signal.removeEventListener('abort', invalidate); unsubscribe() }); assert()
    delivered = true; return view
  } catch (error) { opened?.dispose(); throw error }
  finally { if (!delivered) { unsubscribe(); signal.removeEventListener('abort', invalidate) }; key?.fill(0) }
}

/**
 * An edit of the note as reviewed (`note`, the caller's fresh read): its current epoch key is opened once, with the same
 * checks as readEncryptedNote, the current title and body are compared with the edited text, and only the fields that
 * differ are sealed, at their next field revision. Neither the key nor any plaintext leaves; nothing is stored.
 */
export async function sealEncryptedChanges(client: NotesReadClient, note: ChainNote, edited: { title: string; body: string }, options: { access: Access; signal: AbortSignal }): Promise<{ title?: Uint8Array; body?: Uint8Array }> {
  const { access, signal } = options, who = address(access.owner), generation = access.identity.getSnapshot().generation
  const assert = () => {
    client.assertCurrent()
    if (signal.aborted || access.identity.getSnapshot().phase !== 'unlocked' || access.identity.getSnapshot().generation !== generation) throw new NotesChainError('session')
  }
  assert(); check(!note.deleted && note.mode <= 2 && note.body)
  const epoch = parseEpochPage(await client.epochMetadataRaw(note.id, note.epoch), note.epoch); assert()
  check(equalBytes(epoch.commitment, note.commitment) && epoch.revealedKey.length === 0)
  const raw = await client.wrapRaw(note.id, note.epoch, who); assert()
  if (raw === null) throw new PrivateNoteNoAccess('none')
  const wrap = parseWrap(raw, note.epoch, who)
  if (generation !== wrap.generation) throw new PrivateNoteNoAccess('other-key')
  check(wrap.writer || note.owner === who)
  const sealed = await access.identity.use(identity => {
    if (!equalBytes(sha256(identity.publicKey), wrap.publicKeyHash)) throw new PrivateNoteNoAccess('other-key')
    const context = noteContext(client.chainId, client.realm, note), parts: Uint8Array[] = []
    const key = unwrapForReader(wrap.wrap, identity.secretKey, identity.publicKey, { ...context, reader: who, generation: BigInt(wrap.generation) })
    try {
      check(equalBytes(keyCommitment(key, context), note.commitment))
      const seal = (field: 'title' | 'body', value: string, current: Uint8Array, revision: string) => {
        const before = openField(key, { ...context, field, fieldRevision: BigInt(revision) }, current), after = encodePrivateText(value, field === 'title')
        parts.push(before, after)
        return equalBytes(before, after) ? undefined : sealField(key, { ...context, field, fieldRevision: BigInt(revision) + 1n }, after)
      }
      const title = seal('title', edited.title, note.title, note.titleRevision), body = seal('body', edited.body, note.body!, note.bodyRevision)
      return { ...(title ? { title } : {}), ...(body ? { body } : {}) }
    } finally { key.fill(0); parts.forEach(part => part.fill(0)) }
  }); assert()
  const final = await client.noteMetadata(note.id); assert()
  if (!final || final.stateRevision !== note.stateRevision || final.epoch !== note.epoch || final.ownerGeneration !== note.ownerGeneration) throw new NotesChainError('stale')
  return sealed
}

/**
 * The titles of listed private notes (metadata from an index page, no body), opened in ONE use of the key. A note this
 * key cannot open, or whose envelope or epoch does not match the listed revision, maps to null. Nothing is stored.
 */
export async function readEncryptedTitles(client: NotesReadClient, notes: readonly ChainNote[], options: { owner: string; identity: NotesIdentityController; signal: AbortSignal }): Promise<Map<string, string | null>> {
  const { identity, signal } = options, who = address(options.owner), generation = identity.getSnapshot().generation
  const assert = () => {
    client.assertCurrent()
    if (signal.aborted || identity.getSnapshot().phase !== 'unlocked' || identity.getSnapshot().generation !== generation) throw new NotesChainError('session')
  }
  assert()
  const titles = new Map<string, string | null>(), wraps: { note: ChainNote; wrap: ReturnType<typeof parseWrap> }[] = []
  for (const note of notes) {
    titles.set(note.id, null)
    if (note.deleted || note.mode > 2) continue
    try {
      const epoch = parseEpochPage(await client.epochMetadataRaw(note.id, note.epoch), note.epoch); assert()
      const raw = await client.wrapRaw(note.id, note.epoch, who); assert()
      if (raw === null || !equalBytes(epoch.commitment, note.commitment)) continue
      const wrap = parseWrap(raw, note.epoch, who)
      if (wrap.generation === generation) wraps.push({ note, wrap })
    } catch { assert() }
  }
  if (!wraps.length) return titles
  await identity.use(key => {
    for (const { note, wrap } of wraps) {
      let epochKey: Uint8Array | undefined, title: Uint8Array | undefined
      try {
        if (!equalBytes(sha256(key.publicKey), wrap.publicKeyHash)) continue
        const context = noteContext(client.chainId, client.realm, note)
        epochKey = unwrapForReader(wrap.wrap, key.secretKey, key.publicKey, { ...context, reader: who, generation: BigInt(wrap.generation) })
        if (!equalBytes(keyCommitment(epochKey, context), note.commitment)) continue
        title = openField(epochKey, { ...context, field: 'title', fieldRevision: BigInt(note.titleRevision) }, note.title)
        titles.set(note.id, publicText(title, true))
      } catch { /* not openable with this key: stays null */ }
      finally { epochKey?.fill(0); title?.fill(0) }
    }
  }); assert()
  return titles
}
/** The note's current envelopes, rebuilt as the manifest bytes they were written from: public reads, no key. */
export async function readPrivateAccess(client: NotesReadClient, note: ChainNote, signal: AbortSignal): Promise<Uint8Array> {
  const assert = () => { client.assertCurrent(); if (signal.aborted) throw new NotesChainError('session') }
  assert(); check(!note.deleted && note.mode <= 2)
  const readers = parseReaders(await client.readersRaw(note.id)); assert()
  const entries: Recipient[] = []
  for (const reader of readers) {
    const entry = parseWrap(await client.wrapRaw(note.id, note.epoch, reader), note.epoch, reader); assert()
    entries.push({ address: addressBytes(reader), writer: entry.writer, generation: BigInt(entry.generation), publicKeyHash: entry.publicKeyHash, wrap: entry.wrap })
  }
  const final = await client.noteMetadata(note.id); assert()
  if (!final || final.stateRevision !== note.stateRevision || final.epoch !== note.epoch || final.ownerGeneration !== note.ownerGeneration) throw new NotesChainError('stale')
  return encodeManifest(entries, Number(note.epoch))
}
