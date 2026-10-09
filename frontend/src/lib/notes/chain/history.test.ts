import { describe, expect, it } from 'vitest'
import { encode64 } from './schema'
import { parseHistoryEntry, parseHistoryInfo, parseHistoryPage } from './history'
import { parseHistoryBodyChunk, parseHistoryComment, parseHistoryVersion } from './historyContent'
import info from './__fixtures__/history/info.json'
import page from './__fixtures__/history/page.json'
import entry from './__fixtures__/history/entry.json'
import version from './__fixtures__/history/version.json'
import body from './__fixtures__/history/body.json'
import comment from './__fixtures__/history/comment.json'

const wanted = info.id, cid = comment.comment_id
const cases: [string, unknown, (value: unknown) => unknown][] = [
  ['info', info, value => parseHistoryInfo(value, wanted)], ['page', page, value => parseHistoryPage(value, wanted, '0', '0', 20)],
  ['entry', entry, value => parseHistoryEntry(value, wanted, '2')], ['version', version, value => parseHistoryVersion(value, wanted, '1')],
  ['body', body, value => parseHistoryBodyChunk(value, wanted, '1', 0, 8192)], ['comment', comment, value => parseHistoryComment(value, wanted, cid)],
]
describe('strict public history keeper fixtures', () => {
  it.each(cases)('parses the real %s response and explicit private/absent null', (_name, fixture, parse) => {
    expect(parse(fixture)).toMatchObject({ id: wanted }); expect(parse(null)).toBeNull()
  })
  it.each(cases)('closes the exact %s envelope and request ID', (_name, fixture, parse) => {
    const raw = fixture as Record<string, unknown>
    for (const patch of [{ schema: 'future' }, { id: 'ff'.repeat(16) }, { id: '0'.repeat(32) }, { extra: true }]) expect(() => parse({ ...raw, ...patch })).toThrow('format')
    for (const key of Object.keys(raw)) { const missing = { ...raw }; delete missing[key]; expect(() => parse(missing)).toThrow('format') }
    for (const invalid of [undefined, [], false, Object.create(raw)]) expect(() => parse(invalid)).toThrow('format')
  })
  it('preserves canonical uint64 and rejects overflow/impossible history counters', () => {
    const large = '18446744073709551615'
    expect(parseHistoryInfo({ ...info, head_seq: large }, wanted)?.headSeq).toBe(large)
    for (const n of ['01', '-1', '1e2', '18446744073709551616', '0', 1]) expect(() => parseHistoryInfo({ ...info, head_seq: n }, wanted)).toThrow('format')
    for (const patch of [{ start_body_revision: '2' }, { latest_state_revision: '4' }, { coverage: 'all-private-too' }, { retention: 'temporary' }, { deleted: 1 }]) expect(() => parseHistoryInfo({ ...info, ...patch }, wanted)).toThrow('format')
  })
  it('requires contiguous pages, exact through/next cursor and bounded request limits', () => {
    expect(parseHistoryPage({ ...page, items: [page.items[0]], next_cursor: '1' }, wanted, '0', '2', 1)?.nextCursor).toBe('1')
    expect(parseHistoryPage({ ...page, items: [page.items[1]] }, wanted, '1', '2', 1)?.items[0].seq).toBe('2')
    expect(parseHistoryPage({ ...page, items: [] }, wanted, '2', '2', 20)?.items).toEqual([])
    for (const patch of [{ items: [] }, { items: [page.items[1], page.items[0]] }, { items: [page.items[0], page.items[0]] }, { next_cursor: '2' }, { through_seq: '3' }]) expect(() => parseHistoryPage({ ...page, ...patch }, wanted, '0', '2', 20)).toThrow('format')
    for (const args of [['1', '0', 20], ['3', '2', 20], ['0', '0', 0], ['0', '0', 21], ['0', '0', 1.5]] as const) expect(() => parseHistoryPage(page, wanted, ...args)).toThrow('format')
    for (const patch of [{ action: 'Rotate' }, { comment_id: null }, { op_id: null }, { executor: entry.actor }, { proposal_id: '3' }, { state_revision: '0' }]) {
      expect(() => parseHistoryPage({ ...page, items: [page.items[0], { ...page.items[1], ...patch }] }, wanted, '0', '0', 20)).toThrow('format')
    }
  })
  it('binds entry sequence, typed action details and nullable governance provenance', () => {
    expect(() => parseHistoryEntry(entry, wanted, '3')).toThrow('format')
    for (const patch of [{ governance_action: 'HideComment' }, { detail: { ...entry.detail, leaked_key: 'secret' } }, { detail: { ...entry.detail, content_ref: 'ff'.repeat(16) } }, { detail: { ...entry.detail, anchor_history_body_revision: '2' } }, { detail: { ...entry.detail, parent_history_available: true } }]) expect(() => parseHistoryEntry({ ...entry, ...patch }, wanted, '2')).toThrow('format')
    const governed = { ...entry, action: 'comment-visibility', executor: entry.actor, proposal_id: '7', governance_action: 'HideComment', detail: { ...entry.detail, comment_revision: '2', hidden: true } }
    expect(parseHistoryEntry(governed, wanted, '2')?.governanceAction).toBe('HideComment')
    expect(() => parseHistoryEntry({ ...governed, governance_action: 'ResolveComment' }, wanted, '2')).toThrow('format')
  })
  it('allows unavailable private-era references without accepting private content', () => {
    const archived = { ...comment, content: { ...comment.content, reference: { ...comment.content.reference, anchor_history_body_revision: null, parent: 'ff'.repeat(16), parent_history_available: false } } }
    expect(parseHistoryComment(archived, wanted, cid)?.content.reference.anchorHistoryBodyRevision).toBeNull()
    expect(() => parseHistoryComment({ ...archived, content: { ...archived.content, manifest: 'private' } }, wanted, cid)).toThrow('format')
  })
  it('validates note detail variants including no-op policy target, reveal and cleanup counts', () => {
    const note = { ...entry, action: 'content-commit', state_revision: '2', detail: { snapshot_revision: '2', previous_state_revision: '1', field_mask: 3 } }
    expect(parseHistoryEntry(note, wanted, '2')?.detail).toMatchObject({ kind: 'note', fieldMask: 3 })
    const policy = { ...note, action: 'policy-set', detail: { snapshot_revision: '2', previous_state_revision: '1', policy_op: 1, policy_key: '' } }
    expect(parseHistoryEntry(policy, wanted, '2')?.detail).toMatchObject({ policyOp: 1, policyKey: '' })
    expect(() => parseHistoryEntry({ ...policy, detail: { ...policy.detail, policy_op: 3 } }, wanted, '2')).toThrow('format')
    expect(() => parseHistoryEntry({ ...policy, detail: { snapshot_revision: '2', previous_state_revision: '1' } }, wanted, '2')).toThrow('format')
    expect(parseHistoryEntry({ ...note, action: 'legacy-epoch-reveal', detail: { snapshot_revision: '2', previous_state_revision: '1', target_epoch: '1' } }, wanted, '2')?.detail).toMatchObject({ targetEpoch: '1' })
    for (const patch of [{ field_mask: 0 }, { snapshot_revision: '3' }, { previous_state_revision: null }]) expect(() => parseHistoryEntry({ ...note, detail: { ...note.detail, ...patch } }, wanted, '2')).toThrow('format')
    const cleanup = { ...entry, action: 'cleanup', op_id: null, detail: { comment_index: '1', comments: '1', cooldowns: '0', epochs: '0', requests: '0', total: '2' } }
    expect(parseHistoryEntry(cleanup, wanted, '2')?.detail).toMatchObject({ kind: 'cleanup', total: 2 })
    for (const patch of [{ total: '0' }, { total: '1' }, { total: '51' }, { comments: 1 }]) expect(() => parseHistoryEntry({ ...cleanup, detail: { ...cleanup.detail, ...patch } }, wanted, '2')).toThrow('format')
  })
  it('validates immutable snapshot references, bounded ACL and tombstone null semantics', () => {
    const deleted = { ...version, deleted: true, title_revision: null, title_blob: null, body_revision: null, body_bytes: '0', body_sha256: null, owner_listed: false }
    expect(parseHistoryVersion(deleted, wanted, '1')).toMatchObject({ deleted: true, title: null, bodyRevision: null })
    for (const patch of [{ title_blob: version.title_blob }, { body_revision: '1' }, { owner_listed: true }, { allow_public_writes: true }]) expect(() => parseHistoryVersion({ ...deleted, ...patch }, wanted, '1')).toThrow('format')
    for (const patch of [{ state_revision: '2' }, { mode: 2 }, { title_revision: '2' }, { body_revision: '2' }, { body_bytes: '131073' }, { body_sha256: 'ABC' }, { writers: Array(33).fill(version.owner) }, { writers: [version.owner, version.owner] }, { allow_public_writes: true, mode: 3 }, { policies: { ...version.policies, private: '' } }]) expect(() => parseHistoryVersion({ ...version, ...patch }, wanted, '1')).toThrow('format')
  })
  it('bounds immutable chunks and maximally-sized public comment content/presentation separately', () => {
    expect(parseHistoryBodyChunk(body, wanted, '1', 0, 8192)?.chunk.length).toBe(4)
    for (const patch of [{ body_revision: '2' }, { offset: '1' }, { total: '131073' }, { next_offset: '0' }, { chunk_blob: '' }, { chunk_blob: '!!!!' }]) expect(() => parseHistoryBodyChunk({ ...body, ...patch }, wanted, '1', 0, 8192)).toThrow('format')
    const parsed = parseHistoryComment(comment, wanted, cid)!
    expect(parsed.content.body.length).toBe(4000); expect(parsed.content.anchor.length).toBe(600)
    expect(parseHistoryComment({ ...comment, presentation: { latest_seq: '9', deleted: true, hidden: true, resolved: true } }, wanted, cid)?.content.reference.deleted).toBe(false)
    for (const patch of [{ body_blob: encode64(new Uint8Array(4001)) }, { anchor_blob: encode64(new Uint8Array(601)) }, { body_blob: '/w==' }, { body_blob: encode64(new TextEncoder().encode('a'.repeat(1001))) }, { reference: { ...comment.content.reference, comment_revision: '2' } }]) expect(() => parseHistoryComment({ ...comment, content: { ...comment.content, ...patch } }, wanted, cid)).toThrow('format')
  })
})
