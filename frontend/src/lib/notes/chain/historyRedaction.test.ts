import { describe, expect, it } from 'vitest'
import { parseHistoryEntry, parseHistoryInfo, parseHistoryPage } from './history'
import { parseHistoryComment, parseHistoryVersion } from './historyContent'
import { parsePublicComment } from './comments'
import info from './__fixtures__/history/redaction/redacted-info.json'
import page from './__fixtures__/history/redaction/redacted-page.json'
import version from './__fixtures__/history/redaction/redacted-version.json'
import titleVersion from './__fixtures__/history/redaction/redacted-title-version.json'
import contentEntry from './__fixtures__/history/redaction/content-redact-entry.json'
import commentEntry from './__fixtures__/history/redaction/comment-redact-entry.json'
import purgedEntry from './__fixtures__/history/redaction/comment-redact-purged-entry.json'
import archivedComment from './__fixtures__/history/redaction/redacted-comment.json'
import liveComment from './__fixtures__/history/redaction/redacted-live-comment.json'
import purgedComment from './__fixtures__/history/redaction/redacted-purged-comment.json'

// Fixtures are exported by the merged Notes realm (samcrew-deployer c20e8e6c) on keeper e75fef82c.
const wanted = info.id
describe('moderator redaction in the public history', () => {
  it('accepts the redactable retention and both redaction actions in a page', () => {
    expect(parseHistoryInfo(info, wanted)?.retention).toBe('public-moderator-redactable')
    expect(() => parseHistoryInfo({ ...info, retention: 'permanent-public' }, wanted)).toThrow('format')
    const actions = parseHistoryPage(page, wanted, '0', '0', 20)!.items.map(item => item.action)
    expect(actions).toEqual(expect.arrayContaining(['content-redact', 'comment-redact']))
  })
  it('keeps the revision and body hash of a redacted version without its bytes', () => {
    const v = parseHistoryVersion(version, wanted, '1')!
    expect(v).toMatchObject({ titleRedacted: true, bodyRedacted: true, title: null, bodyBytes: 0, bodyRevision: '1' })
    expect(v.bodySha256).toMatch(/^[a-f0-9]{64}$/)
    expect(parseHistoryVersion(titleVersion, wanted, '4')).toMatchObject({ titleRedacted: false, title: expect.any(Uint8Array) })
    for (const patch of [{ title_blob: titleVersion.title_blob }, { body_bytes: '7' }, { body_sha256: null }, { title_redacted: false }])
      expect(() => parseHistoryVersion({ ...version, ...patch }, wanted, '1')).toThrow('format')
  })
  it('records which field revision was removed, by whom, with its hash', () => {
    const e = parseHistoryEntry(contentEntry, wanted, contentEntry.seq)!
    expect(e.detail).toMatchObject({ kind: 'note', redaction: { field: 'body', fieldRevision: '1', sha256: version.body_sha256 } })
    expect(e.executor).toBeNull()
    expect(() => parseHistoryEntry({ ...contentEntry, detail: { ...contentEntry.detail, field: 'owner' } }, wanted, contentEntry.seq)).toThrow('format')
    expect(() => parseHistoryEntry({ ...contentEntry, detail: { ...contentEntry.detail, sha256: 'x' } }, wanted, contentEntry.seq)).toThrow('format')
    expect(() => parseHistoryEntry({ ...contentEntry, detail: { ...contentEntry.detail, field_revision: '4' } }, wanted, contentEntry.seq)).toThrow('format')
  })
  it('parses live and purged comment redactions', () => {
    expect(parseHistoryEntry(commentEntry, wanted, commentEntry.seq)!.detail).toMatchObject({ kind: 'comment', hidden: true })
    expect(() => parseHistoryEntry({ ...commentEntry, detail: { ...commentEntry.detail, hidden: false } }, wanted, commentEntry.seq)).toThrow('format')
    expect(parseHistoryEntry(purgedEntry, wanted, purgedEntry.seq)!.detail).toEqual({ kind: 'comment-purged', commentId: purgedEntry.detail.comment_id })
    expect(() => parseHistoryEntry({ ...purgedEntry, detail: { ...purgedEntry.detail, purged: false } }, wanted, purgedEntry.seq)).toThrow('format')
    expect(() => parseHistoryEntry({ ...purgedEntry, action: 'comment-delete' }, wanted, purgedEntry.seq)).toThrow('format')
  })
  it('shows an archived redacted comment as empty and a live one as removed', () => {
    const c = parseHistoryComment(archivedComment, wanted, archivedComment.comment_id)!
    expect(c.presentation).toMatchObject({ redacted: true, hidden: true }); expect(c.content.body.length).toBe(0)
    expect(() => parseHistoryComment({ ...archivedComment, presentation: { ...archivedComment.presentation, redacted: false } }, wanted, archivedComment.comment_id)).toThrow('format')
    expect(() => parseHistoryComment({ ...archivedComment, content: { ...archivedComment.content, body_blob: 'YQ==' } }, wanted, archivedComment.comment_id)).toThrow('format')
    // Redacted after its note was purged: the realm leaves presentation.hidden false.
    expect(parseHistoryComment(purgedComment, wanted, purgedComment.comment_id)!.presentation).toMatchObject({ redacted: true, hidden: false })
    expect(parsePublicComment(liveComment)).toMatchObject({ hidden: true, deleted: false, body: '', anchor: '' })
    expect(() => parsePublicComment({ ...liveComment, hidden: false })).toThrow('format')
  })
})
