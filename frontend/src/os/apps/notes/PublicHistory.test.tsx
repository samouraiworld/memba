import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { parseHistoryInfo, type HistoryAction } from '../../../lib/notes/chain/history'
import { parseHistoryComment, parseHistoryVersion } from '../../../lib/notes/chain/historyContent'
import infoFixture from '../../../lib/notes/chain/__fixtures__/history/info.json'
import versionFixture from '../../../lib/notes/chain/__fixtures__/history/version.json'
import commentFixture from '../../../lib/notes/chain/__fixtures__/history/comment.json'
import { PublicHistory } from './PublicHistory'
import { PublicHistoryCommentView, PublicHistoryVersions } from './PublicHistoryContent'
import { announceNoteChange } from '../../../lib/notes/freshness'

const noteId = infoFixture.id, info = parseHistoryInfo(infoFixture, noteId)!
const commentId = commentFixture.comment_id
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function setup(bodyText = 'Body') {
    const bytes = new TextEncoder().encode(bodyText), hash = bytesToHex(sha256(bytes))
    const version = { ...parseHistoryVersion(versionFixture, noteId, '1')!, bodyBytes: bytes.length, bodySha256: hash }
    const comment = parseHistoryComment(commentFixture, noteId, commentId)!
    const mocks = {
        assertCurrent: vi.fn(), chainId: 'test-chain', publicHistoryInfo: vi.fn(async () => info),
        publicHistory: vi.fn(async (_id: string, after = '0', through = '0') => {
            const end = through === '0' ? '21' : through
            const count = Math.min(20, Number(BigInt(end) - BigInt(after)))
            return { id: noteId, throughSeq: end, nextCursor: BigInt(after) + BigInt(count) < BigInt(end) ? String(BigInt(after) + BigInt(count)) : null,
                items: Array.from({ length: count }, (_, i) => ({ seq: String(BigInt(after) + BigInt(i) + 1n), action: 'content-commit' as const,
                    stateRevision: '1', height: '2', actor: version.owner, executor: null, operationId: 'aa'.repeat(16), proposalId: null, commentId: null })) }
        }),
        publicHistoryEntry: vi.fn(async (_id: string, seq: string) => ({ id: noteId, seq, action: 'policy-set' as const, stateRevision: '1',
            height: '2', actor: version.owner, executor: version.owner, operationId: 'aa'.repeat(16), proposalId: '7', governanceAction: 'SetPolicy',
            detail: { kind: 'note' as const, snapshotRevision: '1', previousStateRevision: null, fieldMask: null, policyOp: 1 as const, policyKey: '', targetEpoch: null } })),
        publicHistoryVersion: vi.fn(async (_id: string, revision: string) => ({ ...version, stateRevision: revision })),
        publicHistoryBodyChunk: vi.fn(async (_id: string, revision: string, offset: number, limit: number) => ({ id: noteId, bodyRevision: revision,
            sha256: hash, offset, total: bytes.length, nextOffset: Math.min(offset + limit, bytes.length), chunk: bytes.slice(offset, offset + limit) })),
        publicHistoryComment: vi.fn(async () => comment),
    }
    return { mocks, client: mocks as unknown as NotesReadClient, version, comment }
}
const head = (seq: string) => ({ ...info, headSeq: seq, latestStateRevision: seq })
function timeline(s: ReturnType<typeof setup>, last = '21', action: 'content-commit' | 'public-writes' = 'content-commit') {
    s.mocks.publicHistoryInfo.mockResolvedValue(head(last))
    s.mocks.publicHistory.mockImplementation(async (_id: string, after = '0', through = '0') => {
        const end = through === '0' ? last : through, count = Math.min(20, Number(BigInt(end) - BigInt(after)))
        return { id: noteId, throughSeq: end, nextCursor: BigInt(after) + BigInt(count) < BigInt(end) ? String(BigInt(after) + BigInt(count)) : null,
            items: Array.from({ length: count }, (_, i) => { const seq = String(BigInt(after) + BigInt(i) + 1n); return { seq, action: seq === '1' ? 'create' as const : action,
                stateRevision: seq, height: String(100 + Number(seq)), actor: s.version.owner, executor: null, operationId: 'aa'.repeat(16), proposalId: null, commentId: null } }) }
    })
    // Every edit here is a body edit: the body counter follows, the title counter stays at 1 (as in the realm).
    s.mocks.publicHistoryVersion.mockImplementation(async (_id: string, revision: string) => ({ ...s.version, stateRevision: revision, titleRevision: '1', bodyRevision: revision, allowPublicWrites: true }))
    s.mocks.publicHistoryEntry.mockImplementation(async (_id: string, seq: string) => entry(s, seq, seq === '1' ? 'create' : action, seq, action === 'content-commit' ? 2 : null))
}
function entry(s: ReturnType<typeof setup>, seq: string, action: HistoryAction, stateRevision: string, fieldMask: 1 | 2 | 3 | null) {
    return { id: noteId, seq, action, stateRevision, height: String(100 + Number(seq)), actor: s.version.owner, executor: null, operationId: 'aa'.repeat(16), proposalId: null, governanceAction: null,
        detail: { kind: 'note' as const, snapshotRevision: stateRevision, previousStateRevision: stateRevision === '1' ? null : String(Number(stateRevision) - 1), fieldMask, policyOp: null, policyKey: null, targetEpoch: null, redaction: null } }
}
/**
 * The realm's counters, replayed: title and body revisions start at 1 and move only when their own field
 * changes, independently of the state revision. create → body edit → SetPublicWrites → Rename → body edit.
 */
function realmSequence(s: ReturnType<typeof setup>) {
    const steps: { action: HistoryAction; mask: 1 | 2 | 3 | null; title: string; titleRevision: string; bodyRevision: string; writes: boolean }[] = [
        { action: 'create', mask: null, title: 'Sushi', titleRevision: '1', bodyRevision: '1', writes: false },
        { action: 'content-commit', mask: 2, title: 'Sushi', titleRevision: '1', bodyRevision: '2', writes: false },
        { action: 'public-writes', mask: null, title: 'Sushi', titleRevision: '1', bodyRevision: '2', writes: true },
        { action: 'content-commit', mask: 1, title: 'Sushi (edited by B)', titleRevision: '2', bodyRevision: '2', writes: true },
        { action: 'content-commit', mask: 2, title: 'Sushi (edited by B)', titleRevision: '2', bodyRevision: '3', writes: true },
    ]
    s.mocks.publicHistoryInfo.mockResolvedValue(head(String(steps.length)))
    s.mocks.publicHistory.mockImplementation(async (_id: string, after = '0', through = '0') => ({ id: noteId, throughSeq: through === '0' ? '5' : through, nextCursor: null,
        items: steps.slice(Number(after)).map((step, i) => { const seq = String(Number(after) + i + 1); return { seq, action: step.action, stateRevision: seq, height: String(100 + i), actor: s.version.owner, executor: null, operationId: 'aa'.repeat(16), proposalId: null, commentId: null } }) }))
    s.mocks.publicHistoryEntry.mockImplementation(async (_id: string, seq: string) => entry(s, seq, steps[Number(seq) - 1].action, seq, steps[Number(seq) - 1].mask))
    s.mocks.publicHistoryVersion.mockImplementation(async (_id: string, revision: string) => {
        const step = steps[Number(revision) - 1]
        return { ...s.version, stateRevision: revision, title: new TextEncoder().encode(step.title), titleRevision: step.titleRevision, bodyRevision: step.bodyRevision, allowPublicWrites: step.writes }
    })
}
const events = () => screen.getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)
describe('public history timeline', () => {
    it('lists the newest revisions first in plain words, and pages to older ones under a fixed head', async () => {
        const s = setup(); timeline(s); render(<PublicHistory client={s.client} noteId={noteId} />)
        await waitFor(() => expect(events()[0]).toBe('Revision 21 · body edited'))
        expect(events()).toHaveLength(20); expect(events().at(-1)).toBe('Revision 2 · body edited')
        expect(s.mocks.publicHistory).toHaveBeenLastCalledWith(noteId, '1', '21', 20)
        expect(screen.queryByRole('button', { name: 'Newer' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Older' }))
        await waitFor(() => expect(events().at(-1)).toBe('Revision 1 · created'))
        expect(s.mocks.publicHistory).toHaveBeenLastCalledWith(noteId, '0', '21', 20)
        fireEvent.click(screen.getByRole('button', { name: 'Newer' }))
        await waitFor(() => expect(s.mocks.publicHistory).toHaveBeenLastCalledWith(noteId, '1', '21', 20))
        expect(screen.getByText(/Earlier versions stay readable here unless a moderator removes them/)).toBeVisible()
    })
    it('names the person, the new title of a rename and the editing setting a change chose', async () => {
        const s = setup(); timeline(s, '3', 'public-writes')
        render(<PublicHistory client={s.client} noteId={noteId} viewer={s.version.owner} />)
        await waitFor(() => expect(events()).toEqual(['Revision 3 · editing opened to everyone', 'Revision 2 · editing opened to everyone', 'Revision 1 · created']))
        expect(screen.getAllByText('You')).toHaveLength(3)
    })
    it('names each edit by the field it changed, with counters that move independently (create, body, editing, rename, body)', async () => {
        const s = setup(); realmSequence(s)
        render(<PublicHistory client={s.client} noteId={noteId} />)
        await waitFor(() => expect(events()).toEqual(['Revision 5 · body edited', 'Revision 4 · renamed', 'Revision 3 · editing opened to everyone', 'Revision 2 · body edited', 'Revision 1 · created']))
        expect(screen.getByText(/“Sushi \(edited by B\)”/)).toBeVisible()
        expect(screen.getAllByText(/“/)).toHaveLength(1)
    })
    it('views an archived revision and uses it as a draft without signing anything', async () => {
        const s = setup(), onRestore = vi.fn(); timeline(s, '2')
        render(<PublicHistory client={s.client} noteId={noteId} onRestore={onRestore} />)
        fireEvent.click(await screen.findByRole('button', { name: 'View revision 1' }))
        await screen.findByText('Body', { selector: 'pre' })
        fireEvent.click(screen.getByRole('button', { name: 'Use revision 2 as a draft' }))
        await waitFor(() => expect(onRestore).toHaveBeenCalledWith({ noteId, sourceStateRevision: '2', title: 'Comments', body: 'Body' }))
        expect(await screen.findByText('Revision 2 was copied into a draft. Nothing was signed.')).toBeVisible()
    })
    it('restores nothing when the history moved during the read', async () => {
        const s = setup(), onRestore = vi.fn(); timeline(s, '2')
        render(<PublicHistory client={s.client} noteId={noteId} onRestore={onRestore} />)
        const button = await screen.findByRole('button', { name: 'Use revision 2 as a draft' })
        s.mocks.publicHistoryInfo.mockResolvedValueOnce(head('2')).mockResolvedValueOnce(head('3'))
        fireEvent.click(button)
        expect(await screen.findByText(/could not be checked against the current history/)).toBeVisible(); expect(onRestore).not.toHaveBeenCalled()
    })
    it('handles authoritative null without requesting pages', async () => {
        const s = setup(); s.mocks.publicHistoryInfo.mockResolvedValue(null as never)
        render(<PublicHistory client={s.client} noteId={noteId} />)
        await screen.findByText('No public history is available for this note.')
        expect(s.mocks.publicHistory).not.toHaveBeenCalled()
    })
    it('fails closed for a missing page and retries explicitly', async () => {
        const s = setup(); timeline(s); s.mocks.publicHistory.mockResolvedValueOnce(null as never)
        render(<PublicHistory client={s.client} noteId={noteId} />)
        await screen.findByRole('alert'); expect(screen.queryByRole('listitem')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
        await screen.findByRole('button', { name: 'Older' })
    })
    it('drops late results across note/client ABA changes', async () => {
        const s = setup(), pending = deferred<typeof info>(); timeline(s)
        s.mocks.publicHistoryInfo.mockReturnValueOnce(pending.promise)
        const view = render(<PublicHistory client={s.client} noteId={noteId} />)
        const newer = setup(); timeline(newer); view.rerender(<PublicHistory client={newer.client} noteId={'ff'.repeat(16)} />)
        await screen.findByRole('button', { name: 'Older' })
        await act(async () => pending.resolve(head('21')))
        expect(events()).toHaveLength(20)
        expect(s.mocks.publicHistory).toHaveBeenCalledTimes(1)
        view.rerender(<PublicHistory client={s.client} noteId={noteId} />)
        await screen.findByRole('button', { name: 'Older' })
    })
    it('loads safely under StrictMode replay', async () => {
        const s = setup(); timeline(s); render(<StrictMode><PublicHistory client={s.client} noteId={noteId} /></StrictMode>)
        await screen.findByRole('button', { name: 'Older' })
        expect(screen.queryByRole('alert')).toBeNull()
    })
})
describe('archived versions and restoration boundary', () => {
    it('assembles split UTF8 through the real bounded body helper and displays text safely', async () => {
        const text = 'a'.repeat(8191) + '😀<script>bad()</script>', s = setup(text)
        render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} />)
        await waitFor(() => expect(document.querySelector('pre')?.textContent).toBe(text))
        expect(s.mocks.publicHistoryBodyChunk).toHaveBeenCalledTimes(2)
        expect(document.querySelector('pre script')).toBeNull()
    })
    it('binds the body helper digest to the selected snapshot', async () => {
        const s = setup(); s.mocks.publicHistoryVersion.mockResolvedValue({ ...s.version, bodySha256: '0'.repeat(64) })
        render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} />)
        await screen.findByRole('alert'); expect(document.querySelector('pre')).toBeNull()
    })
    it('refuses missing versions and mismatched snapshot byte counts', async () => {
        const s = setup(); s.mocks.publicHistoryVersion.mockResolvedValueOnce(null as never)
        const view = render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} />)
        await screen.findByRole('alert')
        s.mocks.publicHistoryVersion.mockResolvedValue({ ...s.version, bodyBytes: 9 })
        view.rerender(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['2']} />)
        await screen.findByRole('alert'); expect(document.querySelector('pre')).toBeNull()
    })
    it('requires explicit reveal of a currently moderated note before loading any version body', async () => {
        const s = setup(); s.mocks.publicHistoryInfo.mockResolvedValue({ ...info, moderatorHidden: true })
        render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} />)
        const reveal = await screen.findByRole('button', { name: 'Show archived content' })
        expect(s.mocks.publicHistoryVersion).not.toHaveBeenCalled()
        fireEvent.click(reveal); await screen.findByText('Body', { selector: 'pre' })
        fireEvent.click(screen.getByRole('button', { name: 'Refresh archived versions' }))
        await screen.findByRole('button', { name: 'Show archived content' }); expect(document.querySelector('pre')).toBeNull()
    })
    it('rechecks visibility after loading and drops content if the head changed', async () => {
        const s = setup(); s.mocks.publicHistoryInfo.mockResolvedValueOnce(info).mockResolvedValue({ ...info, headSeq: '3', moderatorHidden: true })
        render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} />)
        await screen.findByRole('alert'); expect(document.querySelector('pre')).toBeNull()
    })
    it('compares at most two versions without a diff dependency', async () => {
        const s = setup(); const view = render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1', '2']} />)
        await screen.findByText('The content is identical.')
        expect(screen.getAllByRole('article')).toHaveLength(2)
        expect(s.mocks.publicHistoryVersion).toHaveBeenCalledTimes(2)
        view.rerender(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1', '2', '3']} />)
        await screen.findByRole('alert'); expect(screen.queryByRole('article')).toBeNull()
    })
    it('passes copied archived content only, after a fresh visibility read', async () => {
        const s = setup(), onRestore = vi.fn()
        render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} onRestore={onRestore} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Use version 1 as a new draft' }))
        await waitFor(() => expect(onRestore).toHaveBeenCalledOnce())
        expect(onRestore).toHaveBeenCalledWith({ noteId, sourceStateRevision: '1', title: 'Comments', body: 'Body' })
        expect(screen.getByText('Version permissions and visibility')).toBeInTheDocument()
        expect(s.mocks.publicHistoryInfo).toHaveBeenCalledTimes(3)
    })
    it('never offers restore of a deleted current note, even after explicit reveal', async () => {
        const s = setup(), onRestore = vi.fn(); s.mocks.publicHistoryInfo.mockResolvedValue({ ...info, deleted: true })
        render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} onRestore={onRestore} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Show archived content' }))
        expect(await screen.findByRole('button', { name: 'Use version 1 as a new draft' })).toBeDisabled()
        expect(onRestore).not.toHaveBeenCalled()
    })
    it('suppresses a pending restore callback when unmounted or the client lease fails', async () => {
        const s = setup(), onRestore = vi.fn(), pending = deferred<typeof info>()
        const view = render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} onRestore={onRestore} />)
        const button = await screen.findByRole('button', { name: 'Use version 1 as a new draft' })
        s.mocks.publicHistoryInfo.mockReturnValueOnce(pending.promise); fireEvent.click(button); view.unmount()
        await act(async () => pending.resolve(info)); expect(onRestore).not.toHaveBeenCalled()
        const other = setup(); render(<PublicHistoryVersions client={other.client} noteId={noteId} revisions={['1']} onRestore={onRestore} />)
        const next = await screen.findByRole('button', { name: 'Use version 1 as a new draft' })
        other.mocks.assertCurrent.mockImplementation(() => { throw new Error('session') }); fireEvent.click(next)
        await screen.findByRole('alert'); expect(onRestore).not.toHaveBeenCalled()
    })
})
describe('public archived comment presentation', () => {
    it('requires the durable current head before explicit hidden/deleted reveal', async () => {
        const s = setup(); s.mocks.publicHistoryComment.mockResolvedValue({ ...s.comment, presentation: { ...s.comment.presentation, hidden: true } })
        render(<PublicHistoryCommentView client={s.client} noteId={noteId} commentId={commentId} />)
        const reveal = await screen.findByRole('button', { name: 'Show archived comment' })
        expect(document.querySelector('pre')).toBeNull()
        fireEvent.click(reveal); await waitFor(() => expect(document.querySelector('pre')).not.toBeNull())
        expect(s.mocks.publicHistoryComment).toHaveBeenCalledTimes(4)
    })
    it('fails closed for unavailable or changed current comment presentation', async () => {
        const s = setup(); s.mocks.publicHistoryComment.mockResolvedValueOnce(s.comment).mockResolvedValue({ ...s.comment, presentation: { ...s.comment.presentation, hidden: true, latestSeq: '3' } })
        render(<PublicHistoryCommentView client={s.client} noteId={noteId} commentId={commentId} />)
        await screen.findByRole('alert'); expect(document.querySelector('pre')).toBeNull()
    })
    it('marks private body/parent references as unavailable without fetching them', async () => {
        const s = setup(); s.mocks.publicHistoryComment.mockResolvedValue({ ...s.comment, content: { ...s.comment.content,
            reference: { ...s.comment.content.reference, anchorHistoryBodyRevision: null, parent: 'cc'.repeat(16), parentHistoryAvailable: false } } })
        render(<PublicHistoryCommentView client={s.client} noteId={noteId} commentId={commentId} />)
        await screen.findByText('The referenced body version is unavailable in the public archive.')
        expect(screen.getByText(/Parent unavailable in the public archive/)).toBeVisible()
        expect(s.mocks.publicHistoryBodyChunk).not.toHaveBeenCalled()
    })
    it('shows no historical comment when its head is missing', async () => {
        const s = setup(); s.mocks.publicHistoryComment.mockResolvedValue(null as never)
        render(<PublicHistoryCommentView client={s.client} noteId={noteId} commentId={commentId} />)
        await screen.findByRole('alert'); expect(document.querySelector('pre')).toBeNull()
    })
})
describe('moderator redaction', () => {
    it('shows a redacted version as removed, keeps its hash and offers no restore', async () => {
        const s = setup(), onRestore = vi.fn()
        s.mocks.publicHistoryVersion.mockResolvedValue({ ...s.version, title: null, titleRedacted: true, bodyRedacted: true, bodyBytes: 0 })
        render(<PublicHistoryVersions client={s.client} noteId={noteId} revisions={['1']} onRestore={onRestore} />)
        await screen.findByText(`The title and body of this version were removed by moderation. Body SHA-256 kept: ${s.version.bodySha256}`)
        expect(s.mocks.publicHistoryBodyChunk).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: /as a new draft/ })).toBeNull()
        expect(document.querySelector('pre')).toBeNull()
    })
    it('never shows archived content for a redacted comment, even when revealed', async () => {
        const s = setup()
        s.mocks.publicHistoryComment.mockResolvedValue({ ...s.comment, content: { ...s.comment.content, body: new Uint8Array(), anchor: new Uint8Array() },
            presentation: { ...s.comment.presentation, hidden: true, redacted: true } })
        render(<PublicHistoryCommentView client={s.client} noteId={noteId} commentId={commentId} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Show archived comment' }))
        await screen.findByText('This comment was removed by moderation. Only its record remains in the public archive.')
        expect(document.querySelector('pre')).toBeNull()
    })
})

describe('public history freshness', () => {
    it('reloads from the head after a confirmed change, but not when nothing new was recorded', async () => {
        const s = setup(); timeline(s, '21'); render(<PublicHistory client={s.client} noteId={noteId} />)
        await waitFor(() => expect(events()[0]).toBe('Revision 21 · body edited'))
        act(() => announceNoteChange({ chainId: 'test-chain', noteId }))
        await waitFor(() => expect(s.mocks.publicHistoryInfo).toHaveBeenCalledTimes(2))
        expect(s.mocks.publicHistory).toHaveBeenCalledOnce()
        s.mocks.publicHistoryInfo.mockReset(); s.mocks.publicHistoryInfo.mockResolvedValueOnce(head('21')).mockResolvedValue(head('22'))
        timeline(s, '22'); s.mocks.publicHistoryInfo.mockReset(); s.mocks.publicHistoryInfo.mockResolvedValueOnce(head('21')).mockResolvedValue(head('22'))
        act(() => announceNoteChange({ chainId: 'test-chain', noteId, stateRevision: '22' }))
        await waitFor(() => expect(events()[0]).toBe('Revision 22 · body edited'), { timeout: 3000 })
        expect(s.mocks.publicHistory).toHaveBeenLastCalledWith(noteId, '2', '22', 20)
        // The first answer lagged behind the announced revision 22 and was read again.
        expect(s.mocks.publicHistoryInfo.mock.calls.length).toBeGreaterThanOrEqual(3)
    })
})
