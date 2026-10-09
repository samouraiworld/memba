import { check, decimal, id, record } from './schema'

/** Exact C1 getter contract; deliberately separate from NoteJSON. */
export interface PublicCapabilities {
  id: string; stateRevision: string; ownerGeneration: string; mode: 3 | 4
  deleted: boolean; allowPublicWrites: boolean
}
export function parsePublicCapabilities(value: unknown): PublicCapabilities | null {
  if (value === null) return null
  const v = record(value, ['schema', 'id', 'state_revision', 'owner_generation', 'mode', 'deleted', 'allow_public_writes'])
  check(v.schema === 'memba-notes/public-capabilities/v1')
  check((v.mode === 3 || v.mode === 4) && typeof v.deleted === 'boolean' && typeof v.allow_public_writes === 'boolean')
  check(!v.allow_public_writes || (v.mode === 4 && !v.deleted))
  const stateRevision = decimal(v.state_revision, 64, true), ownerGeneration = decimal(v.owner_generation, 64, true)
  check(BigInt(ownerGeneration) <= BigInt(stateRevision))
  return { id: id(v.id), stateRevision, ownerGeneration,
    mode: v.mode, deleted: v.deleted, allowPublicWrites: v.allow_public_writes }
}
