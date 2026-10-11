import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { parseHistoryInfo } from '../../../lib/notes/chain/history'
import { parseHistoryComment, parseHistoryVersion } from '../../../lib/notes/chain/historyContent'
import infoFixture from '../../../lib/notes/chain/__fixtures__/history/info.json'
import versionFixture from '../../../lib/notes/chain/__fixtures__/history/version.json'
import commentFixture from '../../../lib/notes/chain/__fixtures__/history/comment.json'
import { PublicHistory } from './PublicHistory'
import { PublicHistoryCommentView, PublicHistoryVersions } from './PublicHistoryContent'

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
describe('public history navigation', () => {
    it('works for a guest and fixes through_seq across next/previous pages', async () => {
        const s = setup(); render(<PublicHistory client={s.client} noteId={noteId} />)
        await screen.findByRole('button', { name: 'Next history' })
        expect(screen.getAllByRole('button', { name: /^Event/ })).toHaveLength(20)
        fireEvent.click(screen.getByRole('button', { name: 'Next history' }))
        await screen.findByRole('button', { name: 'Event 21: Content updated' })
        expect(s.mocks.publicHistory).toHaveBeenLastCalledWith(noteId, '20', '21', 20)
        fireEvent.click(screen.getByRole('button', { name: 'Previous history' }))
        await screen.findByRole('button', { name: 'Event 1: Content updated' })
        expect(s.mocks.publicHistory).toHaveBeenLastCalledWith(noteId, '0', '21', 20)
        fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }))
        await waitFor(() => expect(s.mocks.publicHistory).toHaveBeenLastCalledWith(noteId, '0', '0', 20))
        expect(screen.getByText(/Public versions are retained permanently/)).toBeVisible()
    })
    it('reads explicit policy detail and governance provenance', async () => {
        const s = setup(); render(<PublicHistory client={s.client} noteId={noteId} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Event 1: Content updated' }))
        await screen.findByText('Policy: write · cleared')
        expect(screen.getByText(/Executor .*Proposal 7.*SetPolicy/)).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Read version 1' }))
        await screen.findByText('Body', { selector: 'pre' })
        expect(screen.getByRole('button', { name: 'Use version 1 as a new draft' })).toBeDisabled()
    })
    it('handles authoritative null without requesting pages', async () => {
        const s = setup(); s.mocks.publicHistoryInfo.mockResolvedValue(null as never)
        render(<PublicHistory client={s.client} noteId={noteId} />)
        await screen.findByText('No public history is available for this note.')
        expect(s.mocks.publicHistory).not.toHaveBeenCalled()
    })
    it('fails closed for a missing page and retries explicitly', async () => {
        const s = setup(); s.mocks.publicHistory.mockResolvedValueOnce(null as never)
        render(<PublicHistory client={s.client} noteId={noteId} />)
        await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: /^Event/ })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }))
        await screen.findByRole('button', { name: 'Next history' })
    })
    it('drops late results across note/client ABA changes', async () => {
        const s = setup(), pending = deferred<typeof info>()
        s.mocks.publicHistoryInfo.mockReturnValueOnce(pending.promise)
        const view = render(<PublicHistory client={s.client} noteId={noteId} />)
        const newer = setup(); view.rerender(<PublicHistory client={newer.client} noteId={'ff'.repeat(16)} />)
        await screen.findByRole('button', { name: 'Next history' })
        await act(async () => pending.resolve(info))
        expect(screen.getAllByRole('button', { name: /^Event/ })).toHaveLength(20)
        expect(s.mocks.publicHistory).toHaveBeenCalledTimes(1)
        view.rerender(<PublicHistory client={s.client} noteId={noteId} />)
        await screen.findByRole('button', { name: 'Next history' })
    })
    it('loads safely under StrictMode replay', async () => {
        const s = setup(); render(<StrictMode><PublicHistory client={s.client} noteId={noteId} /></StrictMode>)
        await screen.findByRole('button', { name: 'Next history' })
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
