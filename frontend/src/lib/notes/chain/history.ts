import { address, check, decimal, id, record } from './schema'

export const HISTORY_ACTIONS = ['create', 'publish', 'content-commit', 'comment-mode', 'public-writes', 'writer-add', 'writer-remove',
  'owner-propose', 'owner-cancel', 'owner-accept', 'policy-set', 'gov-writers', 'owner-listing', 'listing-moderation',
  'note-delete', 'legacy-epoch-reveal', 'comment-add', 'comment-delete', 'comment-visibility', 'comment-resolution', 'cleanup'] as const
export type HistoryAction = typeof HISTORY_ACTIONS[number]
export function historyBoolean(value: unknown): boolean { check(typeof value === 'boolean'); return value }
export function historyNullable<T>(value: unknown, parse: (v: unknown) => T): T | null { return value === null ? null : parse(value) }
export const historyRevision = (value: unknown) => decimal(value, 64, true)
export function historyPolicyKey(value: unknown): string {
  check(typeof value === 'string' && value.length <= 233)
  if (value) {
    const parts = value.split(':')
    check(parts.length === 2 && parts[0].length <= 200 && parts[0].startsWith('gno.land/r/'))
    check(/^[a-z0-9-]{1,32}$/.test(parts[1]) && !/[\s\p{Cc}]/u.test(parts[0]))
  }
  return value
}
export function historyRecord(value: unknown, name: string, keys: string[], wanted: string) {
  const v = record(value, ['schema', 'id', ...keys])
  check(v.schema === `memba.notes.public-history-${name}/v1` && id(v.id) === id(wanted))
  return v
}
export function parseHistoryInfo(value: unknown, wanted: string) {
  id(wanted); if (value === null) return null
  const v = historyRecord(value, 'info', ['start_state_revision', 'start_body_revision', 'head_seq', 'latest_state_revision', 'retention', 'coverage', 'deleted', 'moderator_hidden'], wanted)
  const startStateRevision = historyRevision(v.start_state_revision), startBodyRevision = historyRevision(v.start_body_revision)
  const headSeq = historyRevision(v.head_seq), latestStateRevision = historyRevision(v.latest_state_revision)
  check(BigInt(startBodyRevision) <= BigInt(startStateRevision) && BigInt(startStateRevision) <= BigInt(latestStateRevision))
  check(BigInt(headSeq) >= BigInt(latestStateRevision) - BigInt(startStateRevision) + 1n)
  check(v.retention === 'permanent-public' && v.coverage === 'public-since-publication-v1')
  return { id: wanted, startStateRevision, startBodyRevision, headSeq, latestStateRevision,
    retention: 'permanent-public' as const, coverage: 'public-since-publication-v1' as const,
    deleted: historyBoolean(v.deleted), moderatorHidden: historyBoolean(v.moderator_hidden) }
}
const ENTRY_FIELDS = ['seq', 'action', 'height', 'state_revision', 'actor', 'executor', 'op_id', 'proposal_id']
const COMMENT_ACTIONS: readonly string[] = ['comment-add', 'comment-delete', 'comment-visibility', 'comment-resolution']
function entryFields(v: Record<string, unknown>) {
  check(typeof v.action === 'string' && (HISTORY_ACTIONS as readonly string[]).includes(v.action))
  const action = v.action as HistoryAction, executor = historyNullable(v.executor, address)
  const proposalId = historyNullable(v.proposal_id, historyRevision), operationId = historyNullable(v.op_id, id)
  check((executor === null) === (proposalId === null))
  check((operationId === null) === (action === 'cleanup' && executor === null))
  const seq = historyRevision(v.seq), stateRevision = historyRevision(v.state_revision)
  check((seq === '1') === (action === 'create' || action === 'publish') && (action !== 'create' || stateRevision === '1'))
  return { seq, action, height: decimal(v.height, 63, true), stateRevision,
    actor: address(v.actor), executor, operationId, proposalId }
}
export function historyPageArgs(afterSeq: string, throughSeq: string, limit: number): void {
  decimal(afterSeq); decimal(throughSeq)
  check(Number.isInteger(limit) && limit >= 1 && limit <= 20 && BigInt(afterSeq) <= BigInt(throughSeq))
  check(throughSeq !== '0' || afterSeq === '0')
}
export function parseHistoryPage(value: unknown, wanted: string, afterSeq: string, throughSeq: string, limit: number) {
  id(wanted); historyPageArgs(afterSeq, throughSeq, limit); if (value === null) return null
  const v = historyRecord(value, 'page', ['through_seq', 'items', 'next_cursor'], wanted)
  const through = historyRevision(v.through_seq), after = BigInt(afterSeq)
  check((throughSeq === '0' || through === throughSeq) && after <= BigInt(through))
  const expected = Number(BigInt(through) - after < BigInt(limit) ? BigInt(through) - after : BigInt(limit))
  check(Array.isArray(v.items) && v.items.length === expected)
  const items = v.items.map((item, index) => {
    const raw = record(item, [...ENTRY_FIELDS, 'comment_id']), entry = entryFields(raw)
    const commentId = historyNullable(raw.comment_id, id)
    check(BigInt(entry.seq) === after + BigInt(index) + 1n && COMMENT_ACTIONS.includes(entry.action) === (commentId !== null))
    return { ...entry, commentId }
  })
  for (let i = 1; i < items.length; i++) check(BigInt(items[i].height) >= BigInt(items[i - 1].height) && BigInt(items[i].stateRevision) >= BigInt(items[i - 1].stateRevision))
  const last = after + BigInt(items.length), nextCursor = historyNullable(v.next_cursor, historyRevision)
  check(nextCursor === (last < BigInt(through) ? last.toString() : null))
  return { id: wanted, throughSeq: through, items, nextCursor }
}
export function parseHistoryCommentReference(value: unknown) {
  const v = record(value, ['comment_id', 'comment_revision', 'content_ref', 'body_revision', 'anchor_history_body_revision', 'parent', 'parent_history_available', 'deleted', 'hidden', 'resolved'])
  const commentId = id(v.comment_id), contentRef = id(v.content_ref), bodyRevision = historyRevision(v.body_revision)
  const anchorHistoryBodyRevision = historyNullable(v.anchor_history_body_revision, historyRevision), parent = historyNullable(v.parent, id)
  const parentHistoryAvailable = historyBoolean(v.parent_history_available)
  check(contentRef === commentId && (anchorHistoryBodyRevision === null || anchorHistoryBodyRevision === bodyRevision))
  check(parent !== commentId && (!parentHistoryAvailable || parent !== null))
  return { commentId, commentRevision: historyRevision(v.comment_revision), contentRef, bodyRevision, anchorHistoryBodyRevision, parent, parentHistoryAvailable,
    deleted: historyBoolean(v.deleted), hidden: historyBoolean(v.hidden), resolved: historyBoolean(v.resolved) }
}
const GOV_ACTION: Partial<Record<HistoryAction, readonly string[]>> = {
  publish: ['Publish'], 'content-commit': ['Commit', 'Rename'], 'comment-mode': ['SetCommentMode'], 'public-writes': ['SetPublicWrites'],
  'writer-add': ['AddWriter'], 'writer-remove': ['RemoveWriter'], 'owner-propose': ['ProposeOwner'], 'owner-cancel': ['ProposeOwner'],
  'owner-accept': ['AcceptOwnership'], 'policy-set': ['SetPolicy'], 'gov-writers': ['SetGovWriters'], 'owner-listing': ['SetListed'],
  'listing-moderation': ['ModerateListing', 'SetListed'], 'note-delete': ['Delete'], 'legacy-epoch-reveal': ['Reveal'],
  'comment-visibility': ['HideComment'], 'comment-resolution': ['ResolveComment'], cleanup: ['Purge'],
}
function parseDetail(value: unknown, action: HistoryAction, stateRevision: string) {
  if (COMMENT_ACTIONS.includes(action)) {
    const comment = parseHistoryCommentReference(value)
    if (action === 'comment-add') check(comment.commentRevision === '1' && !comment.deleted && !comment.hidden && !comment.resolved)
    else check(BigInt(comment.commentRevision) > 1n)
    if (action === 'comment-delete') check(comment.deleted)
    return { kind: 'comment' as const, ...comment }
  }
  if (action === 'cleanup') {
    const keys = ['comment_index', 'comments', 'cooldowns', 'epochs', 'requests', 'total'], v = record(value, keys)
    const amounts = keys.map(key => Number(decimal(v[key], 8)))
    check(amounts.every(n => n <= 50) && amounts[5] > 0 && amounts.slice(0, 5).reduce((a, b) => a + b, 0) === amounts[5])
    return { kind: 'cleanup' as const, commentIndex: amounts[0], comments: amounts[1], cooldowns: amounts[2], epochs: amounts[3], requests: amounts[4], total: amounts[5] }
  }
  const extra = action === 'content-commit' ? ['field_mask'] : action === 'legacy-epoch-reveal' ? ['target_epoch'] : action === 'policy-set' ? ['policy_op', 'policy_key'] : []
  const v = record(value, ['snapshot_revision', 'previous_state_revision', ...extra])
  const snapshotRevision = historyRevision(v.snapshot_revision), previousStateRevision = historyNullable(v.previous_state_revision, historyRevision)
  check(snapshotRevision === stateRevision)
  if (action === 'create' || action === 'publish') check(previousStateRevision === null && (action !== 'create' || stateRevision === '1'))
  else check(previousStateRevision !== null && BigInt(previousStateRevision) + 1n === BigInt(stateRevision))
  const fieldMask = action === 'content-commit' ? v.field_mask : null
  check(fieldMask === null || fieldMask === 1 || fieldMask === 2 || fieldMask === 3)
  const policyOp = action === 'policy-set' ? v.policy_op : null
  check(policyOp === null || policyOp === 0 || policyOp === 1 || policyOp === 2)
  return { kind: 'note' as const, snapshotRevision, previousStateRevision, fieldMask: fieldMask as 1 | 2 | 3 | null,
    policyOp: policyOp as 0 | 1 | 2 | null, policyKey: action === 'policy-set' ? historyPolicyKey(v.policy_key) : null,
    targetEpoch: action === 'legacy-epoch-reveal' ? decimal(v.target_epoch, 32, true) : null }
}
export function parseHistoryEntry(value: unknown, wanted: string, seq: string) {
  id(wanted); historyRevision(seq); if (value === null) return null
  const v = historyRecord(value, 'entry', [...ENTRY_FIELDS, 'governance_action', 'detail'], wanted), entry = entryFields(v)
  check(entry.seq === seq)
  const governanceAction = v.governance_action
  if (entry.executor === null) check(governanceAction === null)
  else check(typeof governanceAction === 'string' && GOV_ACTION[entry.action]?.includes(governanceAction))
  const detail = parseDetail(v.detail, entry.action, entry.stateRevision)
  if (entry.action === 'create' || entry.action === 'publish') check(seq === '1')
  if (governanceAction === 'Rename') check(detail.kind === 'note' && detail.fieldMask === 1)
  return { id: wanted, ...entry, governanceAction: governanceAction as string | null, detail }
}
export type PublicHistoryInfo = NonNullable<ReturnType<typeof parseHistoryInfo>>
export type PublicHistoryPage = NonNullable<ReturnType<typeof parseHistoryPage>>
export type PublicHistoryEntry = NonNullable<ReturnType<typeof parseHistoryEntry>>
