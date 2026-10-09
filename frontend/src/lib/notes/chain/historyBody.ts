import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { NotesReadClient } from './client'
import { check, decimal, id, NotesChainError, publicText } from './schema'

/** At most sixteen bounded chunks, including one empty chunk for an empty body. No live-note dependency. */
export async function readPublicHistoryBody(client: Pick<NotesReadClient, 'assertCurrent' | 'publicHistoryBodyChunk'>, noteId: string, bodyRevision: string) {
  client.assertCurrent()
  const first = await client.publicHistoryBodyChunk(noteId, bodyRevision, 0, 8192); client.assertCurrent()
  if (first === null) return null
  check(first.id === id(noteId) && first.bodyRevision === decimal(bodyRevision, 64, true) && first.offset === 0)
  check(Number.isInteger(first.total) && first.total >= 0 && first.total <= 131072 && first.chunk.length === Math.min(8192, first.total) && first.nextOffset === first.chunk.length)
  const body = new Uint8Array(first.total)
  try {
    body.set(first.chunk)
    let offset = first.nextOffset
    for (let count = 1; offset < body.length && count < 16; count++) {
      const next = await client.publicHistoryBodyChunk(noteId, bodyRevision, offset, 8192); client.assertCurrent()
      if (!next || next.id !== first.id || next.bodyRevision !== first.bodyRevision || next.sha256 !== first.sha256 || next.total !== first.total
        || next.offset !== offset || next.chunk.length !== Math.min(8192, body.length - offset) || next.nextOffset !== offset + next.chunk.length) throw new NotesChainError('stale')
      body.set(next.chunk, offset); offset = next.nextOffset
    }
    if (offset !== body.length || bytesToHex(sha256(body)) !== first.sha256) throw new NotesChainError('format')
    // Chunks may split a multibyte code point. Decode only the verified complete body.
    return { id: first.id, bodyRevision: first.bodyRevision, sha256: first.sha256, text: publicText(body) }
  } finally { body.fill(0) }
}
