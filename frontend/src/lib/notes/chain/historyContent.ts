import { address, blob, check, decimal, id, publicText, record } from './schema'
import { historyBoolean, historyNullable, historyPolicyKey, historyRecord, historyRevision, parseHistoryCommentReference } from './history'

export function historyHash(value: unknown): string { check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); return value }
export function parseHistoryVersion(value: unknown, wanted: string, stateRevision: string) {
  id(wanted); historyRevision(stateRevision); if (value === null) return null
  const v = historyRecord(value, 'version', ['state_revision', 'recorded_seq', 'owner', 'pending_owner', 'owner_is_realm', 'owner_generation',
    'mode', 'epoch', 'title_revision', 'title_blob', 'body_revision', 'body_bytes', 'body_sha256', 'writers', 'policies', 'gov_writers',
    'allow_public_writes', 'owner_listed', 'moderator_hidden', 'deleted'], wanted)
  check(historyRevision(v.state_revision) === stateRevision && (v.mode === 3 || v.mode === 4))
  const owner = address(v.owner), pendingOwner = historyNullable(v.pending_owner, address), ownerGeneration = historyRevision(v.owner_generation)
  const titleRevision = historyNullable(v.title_revision, historyRevision), bodyRevision = historyNullable(v.body_revision, historyRevision)
  const title = historyNullable(v.title_blob, b => blob(b, 160)), bodyBytes = Number(decimal(v.body_bytes, 32))
  const bodySha256 = historyNullable(v.body_sha256, historyHash), deleted = historyBoolean(v.deleted)
  const ownerListed = historyBoolean(v.owner_listed), allowPublicWrites = historyBoolean(v.allow_public_writes), govWriters = historyBoolean(v.gov_writers)
  check(BigInt(ownerGeneration) <= BigInt(stateRevision) && pendingOwner !== owner && bodyBytes <= 131072)
  check(Array.isArray(v.writers) && v.writers.length <= 32)
  const writers = v.writers.map(w => address(w)); check(new Set(writers).size === writers.length)
  const rawPolicies = record(v.policies, ['read', 'write', 'comment'])
  const policies = { read: historyPolicyKey(rawPolicies.read), write: historyPolicyKey(rawPolicies.write), comment: historyPolicyKey(rawPolicies.comment) }
  if (deleted) check(titleRevision === null && title === null && bodyRevision === null && bodySha256 === null && bodyBytes === 0
    && !ownerListed && !allowPublicWrites && !govWriters && pendingOwner === null && writers.length === 0 && Object.values(policies).every(p => !p))
  else {
    check(titleRevision !== null && title !== null && bodyRevision !== null && bodySha256 !== null)
    check(BigInt(titleRevision) <= BigInt(stateRevision) && BigInt(bodyRevision) <= BigInt(stateRevision)); publicText(title, true)
  }
  check(!allowPublicWrites || (v.mode === 4 && !deleted))
  return { id: wanted, stateRevision, recordedSeq: historyRevision(v.recorded_seq), owner, pendingOwner,
    ownerIsRealm: historyBoolean(v.owner_is_realm), ownerGeneration, mode: v.mode, epoch: decimal(v.epoch, 32),
    titleRevision, title, bodyRevision, bodyBytes, bodySha256, writers, policies, govWriters, allowPublicWrites,
    ownerListed, moderatorHidden: historyBoolean(v.moderator_hidden), deleted }
}
export function historyChunkArgs(offset: number, limit: number): void {
  check(Number.isInteger(offset) && offset >= 0 && offset <= 131072 && Number.isInteger(limit) && limit >= 1 && limit <= 8192)
}
export function parseHistoryBodyChunk(value: unknown, wanted: string, bodyRevision: string, offset: number, limit: number) {
  id(wanted); historyRevision(bodyRevision); historyChunkArgs(offset, limit); if (value === null) return null
  const v = historyRecord(value, 'body', ['body_revision', 'sha256', 'offset', 'total', 'next_offset', 'chunk_blob'], wanted)
  const total = Number(decimal(v.total, 32)), nextOffset = Number(decimal(v.next_offset, 32)), chunk = blob(v.chunk_blob, 8192)
  check(historyRevision(v.body_revision) === bodyRevision && decimal(v.offset, 32) === String(offset))
  check(total <= 131072 && offset <= total && chunk.length === Math.min(limit, total - offset) && nextOffset === offset + chunk.length)
  return { id: wanted, bodyRevision, sha256: historyHash(v.sha256), offset, total, nextOffset, chunk }
}
export function parseHistoryComment(value: unknown, wanted: string, commentId: string) {
  id(wanted); id(commentId); if (value === null) return null
  const v = historyRecord(value, 'comment', ['comment_id', 'content', 'presentation'], wanted)
  check(id(v.comment_id) === commentId)
  const c = record(v.content, ['author', 'created_height', 'epoch', 'anchor_blob', 'body_blob', 'reference'])
  const p = record(v.presentation, ['latest_seq', 'deleted', 'hidden', 'resolved']), reference = parseHistoryCommentReference(c.reference)
  const body = blob(c.body_blob, 4000), anchor = blob(c.anchor_blob, 600)
  check(body.length > 0 && [...publicText(body)].length <= 1000); publicText(anchor)
  check(reference.commentId === commentId && reference.commentRevision === '1' && !reference.deleted && !reference.hidden && !reference.resolved)
  return { id: wanted, commentId, content: { author: address(c.author), createdHeight: decimal(c.created_height, 63, true), epoch: decimal(c.epoch, 32), body, anchor, reference },
    presentation: { latestSeq: historyRevision(p.latest_seq), deleted: historyBoolean(p.deleted), hidden: historyBoolean(p.hidden), resolved: historyBoolean(p.resolved) } }
}
export type PublicHistoryVersion = NonNullable<ReturnType<typeof parseHistoryVersion>>
export type PublicHistoryBodyChunk = NonNullable<ReturnType<typeof parseHistoryBodyChunk>>
export type PublicHistoryComment = NonNullable<ReturnType<typeof parseHistoryComment>>
