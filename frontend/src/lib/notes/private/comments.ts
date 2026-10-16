import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { NotesReadClient } from '../chain/client'
import type { NotesQuoteProvider } from '../chain/request'
import type { OpenedComment } from '../chain/comments'
import { privateCommentBudget } from '../chain/privateCommentMessages'
import type { PrivateComment } from '../chain/privateComments'
import { address, check, decimal, id, NotesChainError, type ChainNote } from '../chain/schema'
import { privateNotesDeployment } from '../config'
import { equalBytes } from '../crypto/bytes'
import { decodeComment, encodeComment, type CommentPayload } from '../crypto/comment'
import { keyCommitment, openField, sealField, type FieldContext } from '../crypto/content'
import { unwrapForReader } from '../crypto/wrap'
import type { NotesIdentityController } from '../identity/controller'
import { noteContext } from './engine'
import { simulationFirstQuote } from './quote'
import { PrivateNoteNoAccess } from './reader'
import { parseEpochPage, parseWrap } from './schema'

/** What binds a comment's ciphertext (AEAD): network, realm, note, epoch, its id, author, parent and anchored body revision. */
export interface PrivateCommentMeta { id: string; author: string; parent: string; bodyRevision: string; epoch: string }
type Options = { owner: string; identity: NotesIdentityController; signal: AbortSignal }
function commentContext(chainId: string, realm: string, noteId: string, m: PrivateCommentMeta): FieldContext {
  check(m.id !== m.parent)
  return { ...noteContext(chainId, realm, { id: noteId, epoch: m.epoch }), field: 'comment', fieldRevision: 1n, commentId: hexToBytes(id(m.id)),
    author: address(m.author), parentId: m.parent ? hexToBytes(id(m.parent)) : new Uint8Array(16), bodyRevision: BigInt(decimal(m.bodyRevision, 64, true)) }
}
/**
 * The keys of `epochs`, each through this account's OWN envelope of that epoch (current key generation, public-key hash,
 * full-context unwrap, the epoch's key commitment), opened in one key use and zeroed right after `work`. An epoch this key
 * holds no envelope for (never shared, removed before it, or another key) maps to null. The private-notes gate, the lock
 * and the account are checked before and after every read.
 */
async function withEpochKeys<T>(client: NotesReadClient, noteId: string, epochs: readonly string[], options: Options, work: (keys: ReadonlyMap<string, Uint8Array | null>, revealed: ReadonlySet<string>) => T): Promise<T> {
  const { identity, signal } = options, who = address(options.owner), generation = identity.getSnapshot().generation
  const assert = () => {
    client.assertCurrent()
    if (signal.aborted || identity.getSnapshot().phase !== 'unlocked' || identity.getSnapshot().generation !== generation) throw new NotesChainError('session')
    if (privateNotesDeployment(client.chainId)?.realm !== client.realm) throw new NotesChainError('disabled')
  }
  assert()
  const found: { epoch: string; commitment: Uint8Array; wrap: ReturnType<typeof parseWrap> | null }[] = [], revealed = new Set<string>()
  for (const epoch of new Set(epochs)) {
    const page = parseEpochPage(await client.epochMetadataRaw(noteId, epoch), epoch); assert()
    if (page.revealedKey.length) revealed.add(epoch)
    const raw = await client.wrapRaw(noteId, epoch, who); assert()
    const wrap = raw === null ? null : parseWrap(raw, epoch, who)
    found.push({ epoch, commitment: page.commitment, wrap: wrap && wrap.generation === generation ? wrap : null })
  }
  const result = await identity.use(key => {
    const keys = new Map<string, Uint8Array | null>()
    try {
      for (const { epoch, commitment, wrap } of found) {
        keys.set(epoch, null)
        if (!wrap || !equalBytes(sha256(key.publicKey), wrap.publicKeyHash)) continue
        const context = noteContext(client.chainId, client.realm, { id: noteId, epoch })
        let epochKey: Uint8Array
        try { epochKey = unwrapForReader(wrap.wrap, key.secretKey, key.publicKey, { ...context, reader: who, generation: BigInt(wrap.generation) }) } catch { continue }
        if (equalBytes(keyCommitment(epochKey, context), commitment)) keys.set(epoch, epochKey); else epochKey.fill(0)
      }
      return work(keys, revealed)
    } finally { keys.forEach(value => value?.fill(0)) }
  }); assert()
  return result
}
/**
 * The text of each live, visible comment, under the key of ITS epoch: "no-key" when this account holds no envelope of that
 * epoch (a reader removed before it was posted, or an earlier version they were never given), "unavailable" when it does
 * not authenticate for its own metadata (moved from another note, epoch, id or author, or corrupted). Nothing is stored.
 */
export async function openPrivateComments(client: NotesReadClient, noteId: string, comments: readonly PrivateComment[], options: Options): Promise<Map<string, OpenedComment>> {
  const live = comments.filter(c => !c.deleted && !c.hidden)
  if (!live.length) return new Map()
  return withEpochKeys(client, noteId, live.map(c => c.epoch), options, keys => new Map(live.map((c): [string, OpenedComment] => {
    const key = keys.get(c.epoch)
    if (!key) return [c.id, { status: 'no-key' }]
    let plain: Uint8Array | undefined
    try {
      plain = openField(key, commentContext(client.chainId, client.realm, noteId, c), c.ciphertext)
      const payload = decodeComment(plain); check(payload.body.length > 0)
      return [c.id, { status: 'open', body: payload.body, quote: payload.quote }]
    } catch { return [c.id, { status: 'unavailable' }] } finally { plain?.fill(0) }
  })))
}
/**
 * A new comment on the note as read (`note`), sealed under its CURRENT epoch key, which must be unrevealed: a Shared note
 * (the realm takes comments from its readers only), this account holding an envelope of that epoch.
 */
export async function sealPrivateComment(client: NotesReadClient, note: ChainNote, meta: PrivateCommentMeta, payload: CommentPayload, options: Options): Promise<Uint8Array> {
  check(!note.deleted && note.mode === 1 && meta.epoch === note.epoch && meta.author === address(options.owner) && BigInt(meta.bodyRevision) <= BigInt(note.bodyRevision) && payload.body.trim().length > 0)
  const plain = encodeComment(payload)
  try {
    const sealed = await withEpochKeys(client, note.id, [note.epoch], options, (keys, revealed) => {
      const key = keys.get(note.epoch)
      if (!key) throw new PrivateNoteNoAccess('none')
      check(!revealed.has(note.epoch))
      return sealField(key, commentContext(client.chainId, client.realm, note.id, meta), plain)
    })
    const final = await client.noteMetadata(note.id); client.assertCurrent()
    if (!final || final.deleted || final.epoch !== note.epoch || final.ownerGeneration !== note.ownerGeneration || final.mode !== 1) throw new NotesChainError('stale')
    return sealed
  } finally { plain.fill(0) }
}
export const privateCommentQuote = (client: NotesReadClient, cap: string): NotesQuoteProvider => simulationFirstQuote(client, cap, privateCommentBudget)
