import type { NotesReadClient } from './client'
import { address, check, NotesChainError } from './schema'
import type { ChainNote } from './schema'

type Client = Pick<NotesReadClient, 'assertCurrent' | 'noteMetadata'> & { writersRaw(noteId: string): Promise<unknown> }
/** Explicit public ACL only. Policy and governance memberships require separate live proofs. */
export async function readPublicWritePermission(client: Client, note: ChainNote, caller: string): Promise<boolean> {
  client.assertCurrent(); address(caller)
  if (note.deleted || note.mode < 3) return false
  if (note.owner === caller) return true
  if (note.mode !== 3) return false
  const raw = await client.writersRaw(note.id); client.assertCurrent()
  check(Array.isArray(raw) && raw.length <= 32)
  const writers = raw.map(who => address(who)); check(new Set(writers).size === writers.length)
  const final = await client.noteMetadata(note.id); client.assertCurrent()
  if (!final || final.deleted || final.id !== note.id || final.owner !== note.owner || final.mode !== note.mode
    || final.stateRevision !== note.stateRevision || final.ownerGeneration !== note.ownerGeneration) throw new NotesChainError('stale')
  return writers.includes(caller)
}

/** Content only: community opt-in never confers comment-resolution or management rights. */
export async function readPublicContentWritePermission(client: Client & Pick<NotesReadClient, 'publicCapabilities'>, note: ChainNote, caller: string): Promise<boolean> {
  client.assertCurrent(); address(caller)
  if (note.deleted || note.mode < 3) return false
  const capability = await client.publicCapabilities(note.id); client.assertCurrent()
  if (capability === null) return false
  if (capability.id !== note.id || capability.stateRevision !== note.stateRevision || capability.ownerGeneration !== note.ownerGeneration
    || capability.mode !== note.mode || capability.deleted !== note.deleted) throw new NotesChainError('stale')
  const permitted = note.mode === 4 && capability.allowPublicWrites || await readPublicWritePermission(client, note, caller)
  client.assertCurrent()
  const final = await client.noteMetadata(note.id); client.assertCurrent()
  if (!final || final.deleted || final.id !== note.id || final.owner !== note.owner || final.mode !== note.mode
    || final.stateRevision !== note.stateRevision || final.ownerGeneration !== note.ownerGeneration || final.epoch !== note.epoch) throw new NotesChainError('stale')
  return permitted
}
